import { PrismaService } from '../src/prisma/prisma.service';
import { ComplianceService } from '../src/modules/compliance/compliance.service';
import { DeletionService } from '../src/modules/compliance/deletion.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';

/**
 * Aprobacion y ejecucion de eliminaciones, contra base REAL.
 *
 * Esto BORRA. La unica forma honesta de probarlo es borrando de verdad y
 * comprobando despues que lo de la otra empresa sigue intacto: con dobles, la
 * prueba solo comprobaria que llamo a los metodos que yo mismo escribi.
 */
describe('Eliminacion de datos: aprobacion y ejecucion (e2e, base real)', () => {
  let prisma: PrismaService;
  let compliance: ComplianceService;
  let deletion: DeletionService;

  let empresaId: string;
  let otraEmpresaId: string;
  let nombreEmpresa: string;

  // Tres personas DISTINTAS Y REALES: quien pide, quien aprueba y quien
  // ejecuta. Reales porque la auditoria tiene clave foranea al usuario — un
  // id inventado no se puede auditar, que es justo lo que debe ocurrir.
  let QUIEN_PIDE: string;
  let QUIEN_APRUEBA: string;
  let QUIEN_EJECUTA: string;

  const actor = (userId: string) => ({ userId, role: 'SUPER_ADMIN' });

  /** Empresa con datos en todas las tablas que el borrado debe alcanzar. */
  const sembrar = async (companyId: string) => {
    const contacto = await prisma.contact.create({
      data: {
        companyId,
        phone: `+1444${Math.random().toString().slice(2, 9)}`,
        name: 'Contacto borrado',
      },
    });
    const conv = await prisma.conversation.create({
      data: { companyId, contactId: contacto.id },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, body: 'hola', direction: 'INBOUND' },
    });
    const pipeline = await prisma.pipeline.create({
      data: { companyId, name: 'Ventas', isDefault: true },
    });
    const etapa = await prisma.pipelineStage.create({
      data: { pipelineId: pipeline.id, name: 'Nuevo', order: 0 },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId,
        contactId: contacto.id,
        pipelineId: pipeline.id,
        stageId: etapa.id,
        title: 'Oportunidad',
      },
    });
    await prisma.task.create({
      data: { companyId, title: 'Tarea', leadId: lead.id },
    });
    await prisma.automation.create({
      data: {
        companyId,
        name: 'Auto',
        trigger: 'first_message',
        actions: [] as never,
      },
    });
    return {
      contactoId: contacto.id,
      conversationId: conv.id,
      leadId: lead.id,
    };
  };

  const cuentaDe = async (companyId: string) => ({
    mensajes: await prisma.message.count({
      where: { conversation: { companyId } },
    }),
    conversaciones: await prisma.conversation.count({ where: { companyId } }),
    contactos: await prisma.contact.count({ where: { companyId } }),
    oportunidades: await prisma.lead.count({ where: { companyId } }),
    automatizaciones: await prisma.automation.count({ where: { companyId } }),
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new PlatformAuditLogService(prisma);
    compliance = new ComplianceService(prisma, audit);
    deletion = new DeletionService(prisma, audit);

    const empresa = await prisma.company.create({
      data: { name: `E2E Borrado ${Date.now()}` },
    });
    empresaId = empresa.id;
    nombreEmpresa = empresa.name;

    const otra = await prisma.company.create({
      data: { name: 'E2E Borrado Vecina' },
    });
    otraEmpresaId = otra.id;

    const crearUsuario = async (nombre: string, role: string) => {
      const u = await prisma.user.create({
        data: {
          companyId: role === 'SUPER_ADMIN' ? null : empresaId,
          email: `${nombre}-${Date.now()}-${Math.random().toString().slice(2, 6)}@example.test`,
          password: 'x',
          name: nombre,
          role: role as never,
        },
      });
      return u.id;
    };
    QUIEN_PIDE = await crearUsuario('solicitante', 'ADMIN');
    QUIEN_APRUEBA = await crearUsuario('aprobador', 'SUPER_ADMIN');
    QUIEN_EJECUTA = await crearUsuario('ejecutor', 'SUPER_ADMIN');

    await sembrar(empresaId);
    await sembrar(otraEmpresaId);
  });

  afterAll(async () => {
    for (const id of [empresaId, otraEmpresaId]) {
      await prisma.auditLog.deleteMany({ where: { affectedCompanyId: id } });
      await prisma.dataRequest.deleteMany({ where: { companyId: id } });
      await prisma.message.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.task.deleteMany({ where: { companyId: id } });
      await prisma.leadStageHistory.deleteMany({
        where: { lead: { companyId: id } },
      });
      await prisma.lead.deleteMany({ where: { companyId: id } });
      await prisma.conversation.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.automation.deleteMany({ where: { companyId: id } });
      await prisma.pipelineStage.deleteMany({
        where: { pipeline: { companyId: id } },
      });
      await prisma.pipeline.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    // Los SUPER_ADMIN de plataforma no tienen empresa: se limpian aparte.
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: [QUIEN_APRUEBA, QUIEN_EJECUTA] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [QUIEN_APRUEBA, QUIEN_EJECUTA] } },
    });
    await prisma.$disconnect();
  });

  const nuevaSolicitud = async () =>
    compliance.requestDeletion(
      empresaId,
      'El cliente solicito el cierre definitivo de su cuenta',
      { userId: QUIEN_PIDE, role: 'ADMIN' },
    );

  describe('cuatro ojos: quien pide no aprueba', () => {
    it('RECHAZA que quien la solicito la apruebe', async () => {
      // Una segunda persona es la unica forma de detectar un error de quien
      // escribio la solicitud.
      const s = await nuevaSolicitud();

      await expect(deletion.approve(s.id, actor(QUIEN_PIDE))).rejects.toThrow(
        /segunda persona/i,
      );
    });

    it('otra persona SI puede aprobarla', async () => {
      const s = await nuevaSolicitud();

      const aprobada = await deletion.approve(s.id, actor(QUIEN_APRUEBA));

      expect(aprobada.status).toBe('APPROVED');
      expect(aprobada.approvedBy).toBe(QUIEN_APRUEBA);
    });

    it('no se puede aprobar dos veces', async () => {
      const s = await nuevaSolicitud();
      await deletion.approve(s.id, actor(QUIEN_APRUEBA));

      await expect(
        deletion.approve(s.id, actor(QUIEN_EJECUTA)),
      ).rejects.toThrow();
    });
  });

  describe('rechazo', () => {
    it('exige un motivo con contenido', async () => {
      const s = await nuevaSolicitud();

      await expect(
        deletion.reject(s.id, 'no', actor(QUIEN_APRUEBA)),
      ).rejects.toThrow();
    });

    it('guarda el motivo y lo audita', async () => {
      const s = await nuevaSolicitud();
      const motivo = 'Faltan los datos de contacto del solicitante';

      const rechazada = await deletion.reject(
        s.id,
        motivo,
        actor(QUIEN_APRUEBA),
      );

      expect(rechazada.status).toBe('REJECTED');
      expect(rechazada.rejectionReason).toBe(motivo);
      const auditoria = await prisma.auditLog.findFirst({
        where: { action: 'DELETION_REJECTED', entityId: s.id },
      });
      expect(auditoria!.reason).toBe(motivo);
    });

    it('una rechazada ya no se puede ejecutar', async () => {
      const s = await nuevaSolicitud();
      await deletion.reject(
        s.id,
        'No procede en este caso',
        actor(QUIEN_APRUEBA),
      );

      await expect(
        deletion.execute(s.id, nombreEmpresa, actor(QUIEN_EJECUTA)),
      ).rejects.toThrow();
    });
  });

  describe('doble confirmacion antes de ejecutar', () => {
    it('NO se ejecuta una solicitud sin aprobar', async () => {
      const s = await nuevaSolicitud();

      await expect(
        deletion.execute(s.id, nombreEmpresa, actor(QUIEN_EJECUTA)),
      ).rejects.toThrow(/aprobada/i);
    });

    it('quien aprueba NO puede ejecutar', async () => {
      // Si lo fuera, la aprobacion seria un tramite que se firma a si mismo.
      const s = await nuevaSolicitud();
      await deletion.approve(s.id, actor(QUIEN_APRUEBA));

      await expect(
        deletion.execute(s.id, nombreEmpresa, actor(QUIEN_APRUEBA)),
      ).rejects.toThrow(/tercera/i);
    });

    it('RECHAZA una confirmacion que no es el nombre exacto', async () => {
      const s = await nuevaSolicitud();
      await deletion.approve(s.id, actor(QUIEN_APRUEBA));

      await expect(
        deletion.execute(s.id, 'si, borrar', actor(QUIEN_EJECUTA)),
      ).rejects.toThrow(/nombre exacto/i);
    });

    it('la confirmacion NO se acepta con mayusculas distintas', async () => {
      // Aceptar variantes convierte "escribe el nombre" en "escribe algo
      // parecido", que es exactamente lo que se hace sin mirar.
      const s = await nuevaSolicitud();
      await deletion.approve(s.id, actor(QUIEN_APRUEBA));

      await expect(
        deletion.execute(
          s.id,
          nombreEmpresa.toUpperCase(),
          actor(QUIEN_EJECUTA),
        ),
      ).rejects.toThrow();
    });

    it('la previsualizacion muestra el recuento SIN borrar', async () => {
      // Quien ejecuta debe ver el numero antes de teclear el nombre.
      const s = await nuevaSolicitud();
      const antes = await cuentaDe(empresaId);

      const vista = await deletion.preview(s.id);

      expect(vista.resumen.mensajes).toBe(antes.mensajes);
      expect(await cuentaDe(empresaId)).toEqual(antes);
    });
  });

  describe('ejecucion', () => {
    it('borra los datos de la empresa y NADA de la vecina', async () => {
      // El fallo que convertiria esto en un incidente entre clientes.
      const vecinaAntes = await cuentaDe(otraEmpresaId);
      const s = await nuevaSolicitud();
      await deletion.approve(s.id, actor(QUIEN_APRUEBA));

      const { resumen } = await deletion.execute(
        s.id,
        nombreEmpresa,
        actor(QUIEN_EJECUTA),
      );

      expect(resumen.mensajes).toBeGreaterThan(0);
      const despues = await cuentaDe(empresaId);
      expect(despues.mensajes).toBe(0);
      expect(despues.conversaciones).toBe(0);
      expect(despues.contactos).toBe(0);
      expect(despues.oportunidades).toBe(0);
      expect(despues.automatizaciones).toBe(0);

      expect(await cuentaDe(otraEmpresaId)).toEqual(vecinaAntes);
    });

    it('la empresa NO se borra: la auditoria necesita a donde apuntar', async () => {
      const empresa = await prisma.company.findUnique({
        where: { id: empresaId },
      });

      expect(empresa).not.toBeNull();
    });

    it('queda auditado con el ejecutor y el recuento', async () => {
      const auditoria = await prisma.auditLog.findFirst({
        where: { affectedCompanyId: empresaId, action: 'DELETION_EXECUTED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditoria).not.toBeNull();
      expect(auditoria!.actorUserId).toBe(QUIEN_EJECUTA);
      expect(auditoria!.metadata).toHaveProperty('mensajes');
    });

    it('la solicitud guarda quien ejecuto y que se borro', async () => {
      const completada = await prisma.dataRequest.findFirst({
        where: { companyId: empresaId, status: 'COMPLETED' },
        orderBy: { requestedAt: 'desc' },
      });

      expect(completada!.executedBy).toBe(QUIEN_EJECUTA);
      expect(completada!.confirmationText).toBe(nombreEmpresa);
      expect(completada!.result).toHaveProperty('mensajes');
      expect(completada!.resolvedAt).not.toBeNull();
    });

    it('una completada no se puede volver a ejecutar', async () => {
      const completada = await prisma.dataRequest.findFirstOrThrow({
        where: { companyId: empresaId, status: 'COMPLETED' },
      });

      await expect(
        deletion.execute(completada.id, nombreEmpresa, actor(QUIEN_EJECUTA)),
      ).rejects.toThrow();
    });
  });

  describe('listado de plataforma', () => {
    it('muestra solicitudes de TODAS las empresas', async () => {
      // Es el panel de plataforma: su trabajo es ver el conjunto.
      const todas = await deletion.listAll();

      expect(todas.length).toBeGreaterThan(0);
      expect(todas[0]).toHaveProperty('company');
    });

    it('se puede filtrar por estado', async () => {
      const completadas = await deletion.listAll('COMPLETED');

      expect(completadas.every((s) => s.status === 'COMPLETED')).toBe(true);
    });
  });
});
