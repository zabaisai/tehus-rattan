import { PrismaService } from '../src/prisma/prisma.service';
import { LeadIntakeService } from '../src/modules/leads/lead-intake.service';
import { AssignmentService } from '../src/modules/assignment/assignment.service';

/**
 * Entrada de oportunidades desde WhatsApp, contra una base REAL.
 *
 * Con mocks no se puede probar lo único que de verdad importa aquí: que dos
 * mensajes simultáneos del mismo contacto no abran dos oportunidades. Esa
 * garantía la da un bloqueo consultivo de PostgreSQL, y un doble de Prisma
 * simplemente no lo tiene. Requiere `docker-compose up -d postgres` con las
 * migraciones aplicadas.
 */
describe('Entrada de oportunidades (e2e, base real)', () => {
  let prisma: PrismaService;
  let intake: LeadIntakeService;
  const notificaciones = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
  };
  const realtime = { leadUpdated: jest.fn() };

  let empresaId: string;
  let pipelineId: string;
  let etapaInicialId: string;
  let asesorId: string;

  const creados: string[] = [];

  const nuevoContacto = async (sufijo: string) => {
    const c = await prisma.contact.create({
      data: {
        companyId: empresaId,
        phone: `+1999${sufijo}`,
        name: `Contacto ${sufijo}`,
      },
    });
    return c.id;
  };

  const nuevaConversacion = async (contactId: string) => {
    const c = await prisma.conversation.create({
      data: { companyId: empresaId, contactId },
    });
    return c.id;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const assignment = new AssignmentService(prisma, notificaciones as never);
    intake = new LeadIntakeService(
      prisma,
      assignment,
      notificaciones as never,
      realtime as never,
    );

    const empresa = await prisma.company.create({
      data: { name: 'E2E Intake Test Co' },
    });
    empresaId = empresa.id;

    const pipeline = await prisma.pipeline.create({
      data: {
        companyId: empresaId,
        name: 'E2E Intake Pipeline',
        isDefault: true,
      },
    });
    pipelineId = pipeline.id;

    const etapa = await prisma.pipelineStage.create({
      data: { pipelineId, name: 'Nuevo', order: 0 },
    });
    etapaInicialId = etapa.id;
    // Una segunda etapa: la oportunidad debe entrar en la PRIMERA, no en
    // cualquiera que devuelva la base.
    await prisma.pipelineStage.create({
      data: { pipelineId, name: 'Contactado', order: 1 },
    });

    const asesor = await prisma.user.create({
      data: {
        companyId: empresaId,
        email: `e2e-intake-${Date.now()}@example.test`,
        password: 'x',
        name: 'Asesor E2E',
        role: 'AGENT',
      },
    });
    asesorId = asesor.id;
  });

  afterAll(async () => {
    await prisma.leadStageHistory.deleteMany({
      where: { leadId: { in: creados } },
    });
    await prisma.conversation.deleteMany({ where: { companyId: empresaId } });
    await prisma.lead.deleteMany({ where: { companyId: empresaId } });
    await prisma.contact.deleteMany({ where: { companyId: empresaId } });
    await prisma.user.deleteMany({ where: { companyId: empresaId } });
    await prisma.pipelineStage.deleteMany({ where: { pipelineId } });
    await prisma.pipeline.deleteMany({ where: { companyId: empresaId } });
    await prisma.company.delete({ where: { id: empresaId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    notificaciones.emit.mockClear();
    notificaciones.emitToCompanyRoles.mockClear();
    realtime.leadUpdated.mockClear();
  });

  describe('primer mensaje de un contacto', () => {
    it('crea la oportunidad en la PRIMERA etapa del pipeline predeterminado', async () => {
      const contactId = await nuevoContacto('0001');
      const conversationId = await nuevaConversacion(contactId);

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId,
        contactName: 'Ana',
      });
      creados.push(r.leadId!);

      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: r.leadId! },
      });
      expect(r.creado).toBe(true);
      expect(lead.stageId).toBe(etapaInicialId);
      expect(lead.pipelineId).toBe(pipelineId);
      expect(lead.status).toBe('OPEN');
    });

    it('ata la conversación a la oportunidad — el vínculo que faltaba', async () => {
      const contactId = await nuevoContacto('0002');
      const conversationId = await nuevaConversacion(contactId);

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId,
      });
      creados.push(r.leadId!);

      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(conv.leadId).toBe(r.leadId);
    });

    it('abre el historial de etapas desde el minuto cero', async () => {
      // Sin esta primera entrada, el primer cambio de etapa no tendría
      // "desde" y el embudo empezaría con un agujero.
      const contactId = await nuevoContacto('0003');
      const conversationId = await nuevaConversacion(contactId);

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId,
      });
      creados.push(r.leadId!);

      const historial = await prisma.leadStageHistory.findMany({
        where: { leadId: r.leadId! },
      });
      expect(historial).toHaveLength(1);
      expect(historial[0].fromStageId).toBeNull();
      expect(historial[0].toStageId).toBe(etapaInicialId);
      // Nadie la creó a mano: la originó el sistema.
      expect(historial[0].changedBy).toBeNull();
    });

    it('el título usa el nombre del contacto, nunca su teléfono', async () => {
      // El tablero es una pantalla compartida y visible desde lejos.
      const contactId = await nuevoContacto('0004');
      const conversationId = await nuevaConversacion(contactId);

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId,
        contactName: 'Ana Pérez',
      });
      creados.push(r.leadId!);

      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: r.leadId! },
      });
      expect(lead.title).toContain('Ana Pérez');
      expect(lead.title).not.toMatch(/\d{6,}/);
    });

    it('sin nombre del contacto sigue creando la oportunidad', async () => {
      const contactId = await nuevoContacto('0005');
      const conversationId = await nuevaConversacion(contactId);

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId,
        contactName: null,
      });
      creados.push(r.leadId!);

      expect(r.creado).toBe(true);
    });
  });

  describe('la regla: una sola oportunidad abierta por contacto', () => {
    it('un segundo mensaje REUTILIZA la oportunidad abierta', async () => {
      const contactId = await nuevoContacto('0010');
      const conv1 = await nuevaConversacion(contactId);
      const conv2 = await nuevaConversacion(contactId);

      const primera = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: conv1,
      });
      creados.push(primera.leadId!);
      const segunda = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: conv2,
      });

      expect(segunda.creado).toBe(false);
      expect(segunda.leadId).toBe(primera.leadId);
      expect(
        await prisma.lead.count({ where: { contactId, status: 'OPEN' } }),
      ).toBe(1);
    });

    it('la segunda conversación también queda atada a la misma oportunidad', async () => {
      const contactId = await nuevoContacto('0011');
      const conv1 = await nuevaConversacion(contactId);
      const conv2 = await nuevaConversacion(contactId);

      const primera = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: conv1,
      });
      creados.push(primera.leadId!);
      await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: conv2,
      });

      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: conv2 },
      });
      expect(conv.leadId).toBe(primera.leadId);
    });

    it.each([['WON'], ['LOST']])(
      'con la anterior cerrada (%s), volver a escribir abre una NUEVA',
      async (estado) => {
        // Escribir meses después es un negocio nuevo, no la reapertura del
        // anterior: mezclarlos falsearía el embudo y el histórico de cierres.
        const contactId = await nuevoContacto(`002${estado === 'WON' ? 0 : 1}`);
        const conv1 = await nuevaConversacion(contactId);
        const conv2 = await nuevaConversacion(contactId);

        const primera = await intake.ensureLeadForConversation({
          companyId: empresaId,
          contactId,
          conversationId: conv1,
        });
        creados.push(primera.leadId!);
        await prisma.lead.update({
          where: { id: primera.leadId! },
          data: { status: estado as never },
        });

        const segunda = await intake.ensureLeadForConversation({
          companyId: empresaId,
          contactId,
          conversationId: conv2,
        });
        creados.push(segunda.leadId!);

        expect(segunda.creado).toBe(true);
        expect(segunda.leadId).not.toBe(primera.leadId);
      },
    );

    it('dos contactos distintos abren oportunidades distintas', async () => {
      const c1 = await nuevoContacto('0030');
      const c2 = await nuevoContacto('0031');

      const r1 = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId: c1,
        conversationId: await nuevaConversacion(c1),
      });
      const r2 = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId: c2,
        conversationId: await nuevaConversacion(c2),
      });
      creados.push(r1.leadId!, r2.leadId!);

      expect(r1.leadId).not.toBe(r2.leadId);
      expect(r2.creado).toBe(true);
    });
  });

  describe('mensajes simultáneos del mismo contacto', () => {
    it('cinco entradas a la vez crean UNA sola oportunidad', async () => {
      // El caso real: una ráfaga de WhatsApp procesada por varios
      // trabajadores. Sin serializar, todos leen "no existe" antes de que
      // ninguno escriba y el contacto acaba con cinco fichas en el tablero.
      const contactId = await nuevoContacto('0040');
      const conversaciones = await Promise.all(
        [0, 1, 2, 3, 4].map(() => nuevaConversacion(contactId)),
      );

      const resultados = await Promise.all(
        conversaciones.map((conversationId) =>
          intake.ensureLeadForConversation({
            companyId: empresaId,
            contactId,
            conversationId,
          }),
        ),
      );
      resultados.forEach((r) => r.leadId && creados.push(r.leadId));

      const ids = new Set(resultados.map((r) => r.leadId));
      expect(ids.size).toBe(1);
      expect(resultados.filter((r) => r.creado)).toHaveLength(1);
      expect(
        await prisma.lead.count({ where: { contactId, status: 'OPEN' } }),
      ).toBe(1);
    });

    it('el bloqueo no serializa contactos distintos', async () => {
      // Si bloqueara por empresa en vez de por contacto, una empresa activa
      // procesaría sus mensajes de uno en uno.
      const contactos = await Promise.all(
        [50, 51, 52].map((n) => nuevoContacto(`00${n}`)),
      );

      const resultados = await Promise.all(
        contactos.map(async (contactId) =>
          intake.ensureLeadForConversation({
            companyId: empresaId,
            contactId,
            conversationId: await nuevaConversacion(contactId),
          }),
        ),
      );
      resultados.forEach((r) => r.leadId && creados.push(r.leadId));

      expect(new Set(resultados.map((r) => r.leadId)).size).toBe(3);
    });
  });

  describe('reparto automático', () => {
    it('asigna la oportunidad Y la conversación al mismo asesor', async () => {
      // Ficha en una bandeja y chat en otra es la forma más rápida de que
      // nadie responda.
      const contactId = await nuevoContacto('0060');
      const conversationId = await nuevaConversacion(contactId);

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId,
      });
      creados.push(r.leadId!);

      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: r.leadId! },
      });
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(lead.assignedTo).toBe(asesorId);
      expect(conv.assignedTo).toBe(asesorId);
    });

    it('avisa al asesor de su nueva oportunidad', async () => {
      const contactId = await nuevoContacto('0061');
      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: await nuevaConversacion(contactId),
      });
      creados.push(r.leadId!);

      expect(notificaciones.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LEAD_ASSIGNED',
          recipientUserId: asesorId,
        }),
      );
    });

    it('sin asesores elegibles entra sin asignar y avisa a los administradores', async () => {
      await prisma.user.update({
        where: { id: asesorId },
        data: { autoAssignEnabled: false },
      });
      const contactId = await nuevoContacto('0062');

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: await nuevaConversacion(contactId),
      });
      creados.push(r.leadId!);

      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: r.leadId! },
      });
      expect(lead.assignedTo).toBeNull();
      expect(notificaciones.emitToCompanyRoles).toHaveBeenCalled();

      await prisma.user.update({
        where: { id: asesorId },
        data: { autoAssignEnabled: true },
      });
    });

    it('con el reparto apagado en la empresa, nada se asigna', async () => {
      await prisma.company.update({
        where: { id: empresaId },
        data: { autoAssignEnabled: false },
      });
      const contactId = await nuevoContacto('0063');

      const r = await intake.ensureLeadForConversation({
        companyId: empresaId,
        contactId,
        conversationId: await nuevaConversacion(contactId),
      });
      creados.push(r.leadId!);

      expect(
        (await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId! } }))
          .assignedTo,
      ).toBeNull();

      await prisma.company.update({
        where: { id: empresaId },
        data: { autoAssignEnabled: true },
      });
    });
  });

  describe('empresa sin pipeline utilizable', () => {
    it('no crea nada y lo dice, en vez de fallar', async () => {
      // La conversación ya está guardada y se atiende igual. Un mensaje
      // perdido sería mucho peor que un tablero incompleto.
      const otra = await prisma.company.create({
        data: { name: 'E2E Intake Sin Pipeline' },
      });
      const contacto = await prisma.contact.create({
        data: {
          companyId: otra.id,
          phone: '+19998887777',
          name: 'Sin pipeline',
        },
      });
      const conv = await prisma.conversation.create({
        data: { companyId: otra.id, contactId: contacto.id },
      });

      const r = await intake.ensureLeadForConversation({
        companyId: otra.id,
        contactId: contacto.id,
        conversationId: conv.id,
      });

      expect(r.leadId).toBeNull();
      expect(r.creado).toBe(false);
      expect(r.motivo).toBe('sin-pipeline');

      await prisma.conversation.delete({ where: { id: conv.id } });
      await prisma.contact.delete({ where: { id: contacto.id } });
      await prisma.company.delete({ where: { id: otra.id } });
    });
  });
});
