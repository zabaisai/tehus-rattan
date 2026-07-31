import { PrismaService } from '../src/prisma/prisma.service';
import {
  ComplianceService,
  RETENCION_MINIMA_MESES,
} from '../src/modules/compliance/compliance.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';

/**
 * Retencion, exportacion y eliminacion contra base REAL.
 *
 * La purga BORRA. Probarla con dobles solo comprobaria que llamo a lo que yo
 * mismo escribi; lo que hay que demostrar es que borra exactamente lo que debe
 * y NADA de otra empresa. Requiere `docker-compose up -d postgres`.
 */
describe('Cumplimiento de datos (e2e, base real)', () => {
  let prisma: PrismaService;
  let compliance: ComplianceService;

  let empresaId: string;
  let otraEmpresaId: string;
  let adminId: string;

  const actor = () => ({ userId: adminId, role: 'ADMIN' });

  const conversacionCon = async (opciones: {
    companyId: string;
    status: string;
    mensajeHaceMeses: number;
  }) => {
    const contacto = await prisma.contact.create({
      data: {
        companyId: opciones.companyId,
        phone: `+1555${Math.random().toString().slice(2, 9)}`,
        name: 'Contacto retencion',
      },
    });
    const conv = await prisma.conversation.create({
      data: {
        companyId: opciones.companyId,
        contactId: contacto.id,
        status: opciones.status as never,
      },
    });
    const cuando = new Date();
    cuando.setMonth(cuando.getMonth() - opciones.mensajeHaceMeses);
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        body: 'mensaje antiguo',
        direction: 'INBOUND',
        createdAt: cuando,
      },
    });
    return conv.id;
  };

  const mensajesDe = (companyId: string) =>
    prisma.message.count({ where: { conversation: { companyId } } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    compliance = new ComplianceService(
      prisma,
      new PlatformAuditLogService(prisma),
    );

    const empresa = await prisma.company.create({
      data: { name: 'E2E Cumplimiento Co' },
    });
    empresaId = empresa.id;
    const otra = await prisma.company.create({
      data: { name: 'E2E Cumplimiento Otra' },
    });
    otraEmpresaId = otra.id;

    const admin = await prisma.user.create({
      data: {
        companyId: empresaId,
        email: `cumplimiento-${Date.now()}@example.test`,
        password: 'x',
        name: 'Admin cumplimiento',
        role: 'ADMIN',
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    for (const id of [empresaId, otraEmpresaId]) {
      await prisma.auditLog.deleteMany({ where: { affectedCompanyId: id } });
      await prisma.dataRequest.deleteMany({ where: { companyId: id } });
      await prisma.message.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.conversation.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  describe('por defecto NO se purga nada', () => {
    it('una empresa nueva nace sin politica de retencion', async () => {
      // Un valor por defecto que borre el historial de una empresa que nunca
      // lo pidio no es una politica: es una perdida de datos con calendario.
      const r = await compliance.getRetention(empresaId);

      expect(r.retentionMonths).toBeNull();
      expect(r.retentionPurgeEnabled).toBe(false);
    });

    it('sin politica, la previsualizacion no propone nada', async () => {
      const r = await compliance.previewPurge(empresaId);

      expect(r.aplicable).toBe(false);
      expect(r.motivo).toBe('sin-politica');
    });

    it('sin politica, purgar se rechaza', async () => {
      await expect(compliance.purge(empresaId, actor())).rejects.toThrow();
    });
  });

  describe('configurar la retencion', () => {
    it('rechaza un plazo por debajo del minimo', async () => {
      // Por debajo se estaria borrando trabajo en curso.
      await expect(
        compliance.setRetention(empresaId, { retentionMonths: 1 }, actor()),
      ).rejects.toThrow(new RegExp(String(RETENCION_MINIMA_MESES)));
    });

    it('rechaza activar la purga sin plazo definido', async () => {
      // Dejarlo pasar produce una configuracion que aparenta estar puesta y
      // no hace nada.
      await expect(
        compliance.setRetention(
          empresaId,
          { retentionPurgeEnabled: true },
          actor(),
        ),
      ).rejects.toThrow();
    });

    it('acepta un plazo valido y lo AUDITA', async () => {
      // Es la decision que explica, meses despues, por que faltan datos.
      await compliance.setRetention(empresaId, { retentionMonths: 6 }, actor());

      const auditoria = await prisma.auditLog.findFirst({
        where: {
          affectedCompanyId: empresaId,
          action: 'RETENTION_POLICY_CHANGED',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditoria).not.toBeNull();
      expect(auditoria!.actorUserId).toBe(adminId);
    });
  });

  describe('la purga exige DOS senales', () => {
    it('con plazo pero sin activar, no purga', async () => {
      // Con una sola senal, un plazo puesto por error empieza a borrar solo.
      await compliance.setRetention(
        empresaId,
        { retentionMonths: 6, retentionPurgeEnabled: false },
        actor(),
      );

      await expect(compliance.purge(empresaId, actor())).rejects.toThrow();
    });

    it('la previsualizacion dice cuantos mensajes se irian, sin borrarlos', async () => {
      // "Se borraran 12.400 mensajes" es una frase que cambia decisiones.
      await conversacionCon({
        companyId: empresaId,
        status: 'CLOSED',
        mensajeHaceMeses: 12,
      });
      const antes = await mensajesDe(empresaId);

      const r = await compliance.previewPurge(empresaId);

      expect(r.mensajes).toBeGreaterThan(0);
      expect(await mensajesDe(empresaId)).toBe(antes);
    });
  });

  describe('que borra la purga y que no', () => {
    beforeAll(async () => {
      await compliance.setRetention(
        empresaId,
        { retentionMonths: 6, retentionPurgeEnabled: true },
        actor(),
      );
    });

    it('NO toca las conversaciones abiertas, por antiguas que sean', async () => {
      // Una conversacion abierta es trabajo en curso, por vieja que sea su
      // fecha de creacion.
      const abierta = await conversacionCon({
        companyId: empresaId,
        status: 'OPEN',
        mensajeHaceMeses: 24,
      });

      await compliance.purge(empresaId, actor());

      const quedan = await prisma.message.count({
        where: { conversationId: abierta },
      });
      expect(quedan).toBe(1);
    });

    it('NO toca los mensajes dentro del plazo', async () => {
      const reciente = await conversacionCon({
        companyId: empresaId,
        status: 'CLOSED',
        mensajeHaceMeses: 1,
      });

      await compliance.purge(empresaId, actor());

      expect(
        await prisma.message.count({ where: { conversationId: reciente } }),
      ).toBe(1);
    });

    it('SI borra los mensajes antiguos de conversaciones cerradas', async () => {
      const antigua = await conversacionCon({
        companyId: empresaId,
        status: 'CLOSED',
        mensajeHaceMeses: 18,
      });

      const r = await compliance.purge(empresaId, actor());

      expect(r.mensajesEliminados).toBeGreaterThan(0);
      expect(
        await prisma.message.count({ where: { conversationId: antigua } }),
      ).toBe(0);
    });

    it('NO toca NADA de otra empresa, aunque cumpla los criterios', async () => {
      // El fallo que convertiria esto en un incidente entre clientes.
      await conversacionCon({
        companyId: otraEmpresaId,
        status: 'CLOSED',
        mensajeHaceMeses: 36,
      });
      const antes = await mensajesDe(otraEmpresaId);

      await compliance.purge(empresaId, actor());

      expect(await mensajesDe(otraEmpresaId)).toBe(antes);
    });

    it('la purga queda auditada con el recuento', async () => {
      await compliance.purge(empresaId, actor());

      const auditoria = await prisma.auditLog.findFirst({
        where: { affectedCompanyId: empresaId, action: 'DATA_PURGED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditoria).not.toBeNull();
      expect(auditoria!.metadata).toHaveProperty('mensajesEliminados');
    });
  });

  describe('exportacion', () => {
    it('devuelve los datos de la empresa', async () => {
      const datos = await compliance.exportCompanyData(empresaId, actor());

      expect(datos.empresa?.id).toBe(empresaId);
      expect(Array.isArray(datos.contactos)).toBe(true);
      expect(Array.isArray(datos.conversaciones)).toBe(true);
    });

    it('NO incluye datos de otra empresa', async () => {
      const datos = await compliance.exportCompanyData(empresaId, actor());

      const serializado = JSON.stringify(datos);
      expect(serializado).not.toContain(otraEmpresaId);
    });

    it('NO incluye credenciales de ningun tipo', async () => {
      // Exportar un secreto cifrado sigue siendo exportar un secreto.
      const datos = await compliance.exportCompanyData(empresaId, actor());

      const serializado = JSON.stringify(datos);
      expect(serializado).not.toMatch(/accessToken|password|secret|token/i);
    });

    it('la exportacion queda auditada', async () => {
      await compliance.exportCompanyData(empresaId, actor());

      const auditoria = await prisma.auditLog.findFirst({
        where: { affectedCompanyId: empresaId, action: 'DATA_EXPORTED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditoria).not.toBeNull();
    });
  });

  describe('solicitud de eliminacion', () => {
    it('NO borra nada: queda pendiente', async () => {
      // Un endpoint que borre el historial completo en una llamada es justo
      // lo que no debe existir.
      const antes = await mensajesDe(empresaId);

      const solicitud = await compliance.requestDeletion(
        empresaId,
        'El cliente solicito el cierre de su cuenta',
        actor(),
      );

      expect(solicitud.status).toBe('PENDING');
      expect(await mensajesDe(empresaId)).toBe(antes);
    });

    it('exige un motivo con contenido', async () => {
      // Una solicitud sin motivo no se puede revisar ni defender despues.
      await expect(
        compliance.requestDeletion(empresaId, 'x', actor()),
      ).rejects.toThrow();
    });

    it('queda auditada con quien la pidio y por que', async () => {
      const motivo = 'Baja voluntaria del cliente numero 42';
      await compliance.requestDeletion(empresaId, motivo, actor());

      const auditoria = await prisma.auditLog.findFirst({
        where: { affectedCompanyId: empresaId, action: 'DELETION_REQUESTED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditoria!.reason).toBe(motivo);
      expect(auditoria!.actorUserId).toBe(adminId);
    });

    it('el listado solo muestra las de la propia empresa', async () => {
      await compliance.requestDeletion(
        otraEmpresaId,
        'Solicitud de la otra empresa',
        actor(),
      );

      const mias = await compliance.listRequests(empresaId);

      expect(mias.every((s) => s.companyId === empresaId)).toBe(true);
    });
  });
});
