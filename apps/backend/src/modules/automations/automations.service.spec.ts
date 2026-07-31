import { NotFoundException } from '@nestjs/common';
import { AutomationsService } from './automations.service';

/**
 * CARACTERIZACIÓN — puerta del motor durable (Automation v2).
 *
 * Fija lo que el "motor" hace HOY. Es deliberadamente honesta sobre sus
 * límites, porque la reforma debe sustituirlo sin perder lo poco que sí
 * garantiza:
 *
 *  LO QUE HAY QUE CONSERVAR
 *   - Una conversación pausada NO ejecuta nada (la pausa humana manda).
 *   - Solo se evalúan automatizaciones activas, en orden `order` ascendente.
 *   - El fallo de una acción no aborta las demás ni tumba el webhook.
 *   - Todo está acotado por companyId.
 *
 *  LO QUE LA REFORMA DEBE CAMBIAR (fijado aquí para que el diff lo muestre)
 *   - Solo 3 disparadores, todos atados a "llegó un mensaje".
 *   - Solo 4 acciones. No hay crear oportunidad, crear tarea, etiquetar,
 *     notificar, esperar ni webhook externo.
 *   - `change_stage` escribe `Conversation.stage` (texto libre), NO mueve el
 *     lead en el pipeline.
 *   - Los errores se tragan: sin reintentos, sin idempotencia, sin historial
 *     de ejecución, sin DLQ.
 *
 * Ids ficticios; ningún dato real.
 */
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const CONV = 'conversation-1';
const PHONE = '573001112233';

describe('AutomationsService (disparadores, acciones y etapa real)', () => {
  let prisma: any;
  let messages: any;
  let conversations: any;
  let whatsapp: any;
  let service: AutomationsService;

  const automation = (over: Partial<any> = {}) => ({
    id: 'a1',
    companyId: COMPANY_A,
    isActive: true,
    trigger: 'message_received',
    conditions: null,
    actions: [],
    order: 0,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      automation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(automation()),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue(automation()),
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({ id: CONV, isPaused: false }),
        // Por defecto la conversación NO tiene oportunidad asociada.
        findFirst: jest.fn().mockResolvedValue({ leadId: null }),
      },
      message: { count: jest.fn().mockResolvedValue(1) },
      lead: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      pipelineStage: { findFirst: jest.fn().mockResolvedValue(null) },
      leadStageHistory: { create: jest.fn() },
      $transaction: jest.fn((cb: any) =>
        typeof cb === 'function' ? cb(prisma) : Promise.all(cb),
      ),
    };
    messages = { create: jest.fn().mockResolvedValue({ id: 'm1' }) };
    conversations = { update: jest.fn().mockResolvedValue({ id: CONV }) };
    whatsapp = { sendMessage: jest.fn().mockResolvedValue('wamid-1') };

    service = new AutomationsService(prisma, messages, conversations, whatsapp);
  });

  describe('CRUD acotado por empresa', () => {
    it('findAll filtra por companyId y ordena por `order`', async () => {
      await service.findAll(COMPANY_A);

      expect(prisma.automation.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_A },
        orderBy: { order: 'asc' },
      });
    });

    it('create fuerza el companyId del contexto', async () => {
      await service.create(COMPANY_A, {
        name: 'Bienvenida',
        trigger: 'first_message',
        actions: [],
      });

      expect(prisma.automation.create.mock.calls[0][0].data.companyId).toBe(
        COMPANY_A,
      );
    });

    it.each([
      ['update', () => service.update('a1', COMPANY_B, { name: 'X' })],
      ['remove', () => service.remove('a1', COMPANY_B)],
    ])(
      '%s falla con 404 si la automatización es de otra empresa',
      async (_n, call) => {
        prisma.automation.findFirst.mockResolvedValue(null);

        await expect(call()).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.automation.update).not.toHaveBeenCalled();
        expect(prisma.automation.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('la pausa humana manda (invariante a conservar)', () => {
    it('una conversación pausada no ejecuta ninguna automatización', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: CONV,
        isPaused: true,
      });

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(prisma.automation.findMany).not.toHaveBeenCalled();
      expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('selección de automatizaciones', () => {
    it('solo consulta las ACTIVAS de la empresa, en orden ascendente', async () => {
      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(prisma.automation.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_A, isActive: true },
        orderBy: { order: 'asc' },
      });
    });
  });

  describe('disparadores disponibles HOY (solo 3)', () => {
    it('message_received dispara siempre', async () => {
      prisma.automation.findMany.mockResolvedValue([
        automation({ actions: [{ type: 'close_conversation' }] }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'lo que sea', PHONE);

      expect(conversations.update).toHaveBeenCalled();
    });

    it('keyword dispara solo si el texto contiene alguna palabra clave', async () => {
      prisma.automation.findMany.mockResolvedValue([
        automation({
          trigger: 'keyword',
          conditions: { keywords: ['precio', 'catalogo'] },
          actions: [{ type: 'close_conversation' }],
        }),
      ]);

      await service.processMessage(
        COMPANY_A,
        CONV,
        'Cual es el PRECIO?',
        PHONE,
      );

      expect(conversations.update).toHaveBeenCalled();
    });

    it('keyword no dispara si no hay coincidencia', async () => {
      prisma.automation.findMany.mockResolvedValue([
        automation({
          trigger: 'keyword',
          conditions: { keywords: ['precio'] },
          actions: [{ type: 'close_conversation' }],
        }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'buenos dias', PHONE);

      expect(conversations.update).not.toHaveBeenCalled();
    });

    it('first_message dispara solo cuando la conversación tiene 1 mensaje', async () => {
      prisma.message.count.mockResolvedValue(1);
      prisma.automation.findMany.mockResolvedValue([
        automation({
          trigger: 'first_message',
          actions: [{ type: 'close_conversation' }],
        }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).toHaveBeenCalled();
    });

    it('first_message no dispara en el segundo mensaje', async () => {
      prisma.message.count.mockResolvedValue(2);
      prisma.automation.findMany.mockResolvedValue([
        automation({
          trigger: 'first_message',
          actions: [{ type: 'close_conversation' }],
        }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).not.toHaveBeenCalled();
    });

    it.each([
      ['stage_changed'],
      ['lead_created'],
      ['task_overdue'],
      ['schedule'],
      ['no_reply'],
    ])('el disparador "%s" NO existe hoy y nunca dispara', async (trigger) => {
      prisma.automation.findMany.mockResolvedValue([
        automation({ trigger, actions: [{ type: 'close_conversation' }] }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).not.toHaveBeenCalled();
    });
  });

  describe('acciones disponibles', () => {
    const conActions = (actions: any[]) =>
      prisma.automation.findMany.mockResolvedValue([automation({ actions })]);

    it('send_message envía por WhatsApp y persiste el saliente como SENT', async () => {
      conActions([{ type: 'send_message', message: 'Hola' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(whatsapp.sendMessage).toHaveBeenCalledWith(
        COMPANY_A,
        PHONE,
        'Hola',
      );
      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_A,
          conversationId: CONV,
          direction: 'OUTBOUND',
          status: 'SENT',
        }),
      );
    });

    it('assign_agent asigna el asesor indicado', async () => {
      conActions([{ type: 'assign_agent', agentId: 'user-9' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).toHaveBeenCalledWith(CONV, COMPANY_A, {
        assignedTo: 'user-9',
      });
    });

    // HUECO CERRADO (bloque 5): change_stage mueve la OPORTUNIDAD. Se
    // mantiene el dual-write sobre Conversation.stage hasta que la columna se
    // retire en una migración posterior.
    it('change_stage mueve el lead a la etapa y deja rastro en el historial', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ leadId: 'lead-1' });
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-viejo',
      });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-nuevo' });
      conActions([{ type: 'change_stage', stage: 'Negociacion' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { stageId: 'stage-nuevo' },
      });
      expect(prisma.leadStageHistory.create).toHaveBeenCalledWith({
        data: {
          leadId: 'lead-1',
          fromStageId: 'stage-viejo',
          toStageId: 'stage-nuevo',
        },
      });
    });

    it('dual-write: sigue escribiendo Conversation.stage durante la transición', async () => {
      conActions([{ type: 'change_stage', stage: 'Negociacion' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).toHaveBeenCalledWith(CONV, COMPANY_A, {
        stage: 'Negociacion',
      });
    });

    it('resuelve la etapa DENTRO del pipeline del propio lead', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ leadId: 'lead-1' });
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-viejo',
      });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-nuevo' });
      conActions([{ type: 'change_stage', stage: 'Negociacion' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      // Acotada al pipeline del lead: una etapa homónima de otro pipeline (o
      // de otra empresa) nunca se aplica.
      expect(prisma.pipelineStage.findFirst).toHaveBeenCalledWith({
        where: { pipelineId: 'pipe-1', name: 'Negociacion' },
        select: { id: true },
      });
    });

    it('sin oportunidad asociada no mueve nada y no falla', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ leadId: null });
      conActions([{ type: 'change_stage', stage: 'Negociacion' }]);

      await expect(
        service.processMessage(COMPANY_A, CONV, 'hola', PHONE),
      ).resolves.toBeUndefined();

      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('una etapa inexistente no mueve el lead', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ leadId: 'lead-1' });
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-viejo',
      });
      prisma.pipelineStage.findFirst.mockResolvedValue(null);
      conActions([{ type: 'change_stage', stage: 'Inventada' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('si el lead ya está en esa etapa no reescribe ni duplica historial', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ leadId: 'lead-1' });
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-igual',
      });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-igual' });
      conActions([{ type: 'change_stage', stage: 'Negociacion' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(prisma.lead.update).not.toHaveBeenCalled();
      expect(prisma.leadStageHistory.create).not.toHaveBeenCalled();
    });

    it('close_conversation cierra la conversación', async () => {
      conActions([{ type: 'close_conversation' }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).toHaveBeenCalledWith(CONV, COMPANY_A, {
        status: 'CLOSED',
      });
    });

    it.each([
      ['create_lead'],
      ['create_task'],
      ['add_tag'],
      ['notify_user'],
      ['wait'],
      ['call_webhook'],
      ['send_template'],
    ])('la acción "%s" NO existe hoy y se ignora en silencio', async (type) => {
      conActions([{ type }]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(whatsapp.sendMessage).not.toHaveBeenCalled();
      expect(conversations.update).not.toHaveBeenCalled();
      expect(messages.create).not.toHaveBeenCalled();
    });

    it('ejecuta las acciones en el orden declarado', async () => {
      conActions([
        { type: 'assign_agent', agentId: 'user-1' },
        { type: 'close_conversation' },
      ]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update.mock.calls[0][2]).toEqual({
        assignedTo: 'user-1',
      });
      expect(conversations.update.mock.calls[1][2]).toEqual({
        status: 'CLOSED',
      });
    });
  });

  describe('manejo de errores HOY: se tragan (la reforma debe darles visibilidad)', () => {
    it('un fallo de envío no aborta las acciones siguientes', async () => {
      whatsapp.sendMessage.mockRejectedValue(new Error('Meta caido'));
      prisma.automation.findMany.mockResolvedValue([
        automation({
          actions: [
            { type: 'send_message', message: 'Hola' },
            { type: 'close_conversation' },
          ],
        }),
      ]);

      await expect(
        service.processMessage(COMPANY_A, CONV, 'hola', PHONE),
      ).resolves.toBeUndefined();

      expect(conversations.update).toHaveBeenCalledWith(CONV, COMPANY_A, {
        status: 'CLOSED',
      });
    });

    it('un fallo no se reintenta ni deja rastro persistido', async () => {
      whatsapp.sendMessage.mockRejectedValue(new Error('Meta caido'));
      prisma.automation.findMany.mockResolvedValue([
        automation({ actions: [{ type: 'send_message', message: 'Hola' }] }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      // Sin reintento, sin AutomationRun, sin DLQ: exactamente un intento y
      // ninguna escritura de estado. Esto es lo que la reforma sustituye.
      expect(whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      expect(messages.create).not.toHaveBeenCalled();
    });

    it('procesar el mismo mensaje dos veces ejecuta las acciones dos veces (sin idempotencia)', async () => {
      prisma.automation.findMany.mockResolvedValue([
        automation({ actions: [{ type: 'close_conversation' }] }),
      ]);

      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);
      await service.processMessage(COMPANY_A, CONV, 'hola', PHONE);

      expect(conversations.update).toHaveBeenCalledTimes(2);
    });
  });
});
