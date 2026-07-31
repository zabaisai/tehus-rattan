import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let prisma: any;
  let conversationsService: any;
  let messagesService: any;
  let inboundQueue: any;
  let outbox: any;
  let leadIntake: any;
  let contactsService: any;
  let automationsService: any;
  let whatsappIntegrationService: any;
  let notifications: any;
  let service: WebhookService;

  const connectedIntegration = {
    id: 'integration-a',
    companyId: 'company-a',
    phoneNumberId: '1234567890',
    displayPhoneNumber: '+50255550000',
    wabaId: 'waba-a',
    status: 'CONNECTED',
  };

  const buildPayload = (overrides: any = {}) => ({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '1234567890' },
              contacts: [{ profile: { name: 'Jane Doe' } }],
              messages: [
                {
                  id: 'wamid.1',
                  from: '50255551111',
                  text: { body: 'Hola' },
                },
              ],
              ...overrides,
            },
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    prisma = {
      contact: { findFirst: jest.fn() },
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    conversationsService = { findOrCreate: jest.fn() };
    messagesService = {
      findByWamid: jest.fn(),
      // Simula la transacción real: ejecuta el callback del outbox con el
      // mensaje ya creado, que es lo que garantiza la atomicidad.
      create: jest.fn(async (_data: any, dentro?: any) => {
        const mensaje = { id: 'message-a' };
        if (dentro) await dentro({}, mensaje);
        return mensaje;
      }),
      applyDeliveryStatus: jest.fn().mockResolvedValue('updated'),
    };
    contactsService = { create: jest.fn() };
    automationsService = { processMessage: jest.fn() };
    whatsappIntegrationService = { findConnectedByPhoneNumberId: jest.fn() };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };

    outbox = {
      record: jest.fn().mockResolvedValue(true),
      markCompletedByKey: jest.fn().mockResolvedValue(undefined),
    };
    inboundQueue = {
      // Por defecto NO encola: las pruebas existentes verifican la ejecución
      // en línea, que es la marcha atrás cuando no hay Redis.
      enqueueInboundMessage: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockReturnValue(false),
    };
    leadIntake = {
      ensureLeadForConversation: jest
        .fn()
        .mockResolvedValue({ leadId: 'lead-1', creado: true, assignedTo: null }),
    };
    service = new WebhookService(
      prisma,
      conversationsService,
      messagesService,
      contactsService,
      automationsService,
      whatsappIntegrationService,
      notifications,
      inboundQueue,
      outbox,
      leadIntake,
    );
  });

  it('resolves the tenant via WhatsAppIntegration and scopes contact/conversation/message to it', async () => {
    whatsappIntegrationService.findConnectedByPhoneNumberId.mockResolvedValue(
      connectedIntegration,
    );
    messagesService.findByWamid.mockResolvedValue(null);
    prisma.contact.findFirst.mockResolvedValue(null);
    contactsService.create.mockResolvedValue({ id: 'contact-a' });
    conversationsService.findOrCreate.mockResolvedValue({
      id: 'conversation-a',
    });
    messagesService.create.mockImplementation(async (_d: any, dentro?: any) => {
      const mensaje = { id: 'message-a' };
      if (dentro) await dentro({}, mensaje);
      return mensaje;
    });
    automationsService.processMessage.mockResolvedValue(undefined);

    await service.processWebhook(buildPayload());

    expect(
      whatsappIntegrationService.findConnectedByPhoneNumberId,
    ).toHaveBeenCalledWith('1234567890');

    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { phone: '50255551111', companyId: 'company-a' },
    });
    expect(contactsService.create).toHaveBeenCalledWith('company-a', {
      phone: '50255551111',
      name: 'Jane Doe',
    });
    expect(conversationsService.findOrCreate).toHaveBeenCalledWith(
      'company-a',
      'contact-a',
    );
    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-a',
        conversationId: 'conversation-a',
        wamid: 'wamid.1',
      }),
      // Segundo argumento: el callback del outbox, que se ejecuta dentro
      // de la misma transacción.
      expect.any(Function),
    );
    // Los efectos YA NO corren en linea: el evento de outbox quedo escrito en
    // la misma transaccion y los ejecuta el worker. Aqui solo se verifica el
    // aislamiento por empresa de lo que si ocurre en el webhook.
    expect(automationsService.processMessage).not.toHaveBeenCalled();

    // prisma.company is never referenced anymore for tenant resolution.
    expect(prisma.company).toBeUndefined();
  });

  it('does not create any data for an unknown phoneNumberId and does not throw', async () => {
    whatsappIntegrationService.findConnectedByPhoneNumberId.mockResolvedValue(
      null,
    );

    await expect(
      service.processWebhook(buildPayload()),
    ).resolves.toBeUndefined();

    expect(contactsService.create).not.toHaveBeenCalled();
    expect(conversationsService.findOrCreate).not.toHaveBeenCalled();
    expect(messagesService.create).not.toHaveBeenCalled();
  });

  it('does not create any data when the integration is not connected and does not throw', async () => {
    // findConnectedByPhoneNumberId already filters by status: CONNECTED,
    // so a disconnected/pending/revoked integration resolves to null here too.
    whatsappIntegrationService.findConnectedByPhoneNumberId.mockResolvedValue(
      null,
    );

    await expect(
      service.processWebhook(buildPayload()),
    ).resolves.toBeUndefined();

    expect(contactsService.create).not.toHaveBeenCalled();
    expect(conversationsService.findOrCreate).not.toHaveBeenCalled();
    expect(messagesService.create).not.toHaveBeenCalled();
  });

  it('does not break and creates no data for a payload without messages', async () => {
    const payload = buildPayload({ messages: undefined });

    await expect(service.processWebhook(payload)).resolves.toBeUndefined();

    expect(
      whatsappIntegrationService.findConnectedByPhoneNumberId,
    ).not.toHaveBeenCalled();
    expect(contactsService.create).not.toHaveBeenCalled();
    expect(conversationsService.findOrCreate).not.toHaveBeenCalled();
    expect(messagesService.create).not.toHaveBeenCalled();
  });

  it('keeps the existing duplicate-by-wamid behavior unchanged', async () => {
    whatsappIntegrationService.findConnectedByPhoneNumberId.mockResolvedValue(
      connectedIntegration,
    );
    messagesService.findByWamid.mockResolvedValue({ id: 'existing-message' });

    await service.processWebhook(buildPayload());

    expect(messagesService.findByWamid).toHaveBeenCalledWith('wamid.1');
    expect(contactsService.create).not.toHaveBeenCalled();
    expect(conversationsService.findOrCreate).not.toHaveBeenCalled();
    expect(messagesService.create).not.toHaveBeenCalled();
  });

  describe('batch processing (never only entry[0]/changes[0]/messages[0])', () => {
    beforeEach(() => {
      whatsappIntegrationService.findConnectedByPhoneNumberId.mockResolvedValue(
        connectedIntegration,
      );
      messagesService.findByWamid.mockResolvedValue(null);
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-a' });
      conversationsService.findOrCreate.mockResolvedValue({
        id: 'conversation-a',
      });
      messagesService.create.mockImplementation(
        async (_d: any, dentro?: any) => {
          const mensaje = { id: 'message-a' };
          if (dentro) await dentro({}, mensaje);
          return mensaje;
        },
      );
      automationsService.processMessage.mockResolvedValue(undefined);
    });

    const textMessage = (id: string, from = '50255551111', body = 'Hola') => ({
      id,
      from,
      type: 'text',
      text: { body },
    });

    const value = (messages: any[]) => ({
      metadata: { phone_number_id: '1234567890' },
      contacts: [{ wa_id: '50255551111', profile: { name: 'Jane Doe' } }],
      messages,
    });

    it('processes messages across multiple entries', async () => {
      await service.processWebhook({
        entry: [
          { changes: [{ value: value([textMessage('wamid.1')]) }] },
          { changes: [{ value: value([textMessage('wamid.2')]) }] },
        ],
      });

      const created = messagesService.create.mock.calls.map(
        (c: any) => c[0].wamid,
      );
      expect(created).toEqual(['wamid.1', 'wamid.2']);
    });

    it('processes multiple changes within one entry', async () => {
      await service.processWebhook({
        entry: [
          {
            changes: [
              { value: value([textMessage('wamid.1')]) },
              { value: value([textMessage('wamid.2')]) },
            ],
          },
        ],
      });
      expect(messagesService.create).toHaveBeenCalledTimes(2);
    });

    it('processes every message inside a single change', async () => {
      await service.processWebhook({
        entry: [
          {
            changes: [
              {
                value: value([textMessage('wamid.1'), textMessage('wamid.2')]),
              },
            ],
          },
        ],
      });
      const created = messagesService.create.mock.calls.map(
        (c: any) => c[0].wamid,
      );
      expect(created).toEqual(['wamid.1', 'wamid.2']);
    });

    // CAMBIO DELIBERADO (add_message_media_and_delivery_status): los medios
    // ya NO se descartan. Se persisten con su tipo y la referencia mediaId,
    // sin descargar el binario dentro del webhook.
    it('persists media messages alongside text in the same batch', async () => {
      await service.processWebhook({
        entry: [
          {
            changes: [
              {
                value: value([
                  {
                    id: 'wamid.img',
                    from: '50255551111',
                    type: 'image',
                    image: {
                      id: 'media-x',
                      mime_type: 'image/jpeg',
                      caption: 'foto',
                    },
                  },
                  textMessage('wamid.txt'),
                ]),
              },
            ],
          },
        ],
      });

      const created = messagesService.create.mock.calls.map((c: any) => c[0]);
      expect(created.map((m: any) => m.wamid)).toEqual([
        'wamid.img',
        'wamid.txt',
      ]);

      const imagen = created[0];
      expect(imagen.type).toBe('IMAGE');
      expect(imagen.mediaId).toBe('media-x');
      expect(imagen.mediaMimeType).toBe('image/jpeg');
      expect(imagen.caption).toBe('foto');
      // El pie de foto es lo que se muestra en el hilo; no se inventa un
      // texto tipo "[imagen]".
      expect(imagen.body).toBe('foto');
      // El binario NO se descarga en el webhook: mediaUrl lo rellena un job.
      expect(imagen.mediaUrl).toBeUndefined();
    });

    it('marks a genuinely unknown type as UNSUPPORTED instead of dropping it', async () => {
      await service.processWebhook({
        entry: [
          {
            changes: [
              {
                value: value([
                  { id: 'wamid.raro', from: '50255551111', type: 'ephemeral' },
                ]),
              },
            ],
          },
        ],
      });

      expect(messagesService.create).toHaveBeenCalledTimes(1);
      expect(messagesService.create.mock.calls[0][0].type).toBe('UNSUPPORTED');
    });

    it('isolates a per-message failure and continues the batch', async () => {
      messagesService.create
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValueOnce({ id: 'message-b' });

      await expect(
        service.processWebhook({
          entry: [
            {
              changes: [
                {
                  value: value([
                    textMessage('wamid.1'),
                    textMessage('wamid.2'),
                  ]),
                },
              ],
            },
          ],
        }),
      ).resolves.toBeUndefined();

      expect(messagesService.create).toHaveBeenCalledTimes(2); // both attempted
    });

    it('safely ignores a status-only payload (delivery/read updates, no messages)', async () => {
      await expect(
        service.processWebhook({
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: '1234567890' },
                    statuses: [{ id: 'wamid.1', status: 'delivered' }],
                  },
                },
              ],
            },
          ],
        }),
      ).resolves.toBeUndefined();

      expect(
        whatsappIntegrationService.findConnectedByPhoneNumberId,
      ).not.toHaveBeenCalled();
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('does not throw on an empty or missing entry array', async () => {
      await expect(service.processWebhook({})).resolves.toBeUndefined();
      await expect(
        service.processWebhook({ entry: [] }),
      ).resolves.toBeUndefined();
      expect(messagesService.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CAPACIDAD NUEVA (add_message_media_and_delivery_status): los payloads
  // `statuses` ya no se descartan. Antes el estado nunca pasaba de SENT.
  // ─────────────────────────────────────────────────────────────
  describe('estados de entrega', () => {
    const statusPayload = (statuses: any[]) => ({
      entry: [{ changes: [{ value: { statuses } }] }],
    });

    it('aplica sent, delivered, read y failed', async () => {
      await service.processWebhook(
        statusPayload([
          { id: 'wamid.a', status: 'sent', timestamp: '1790000000' },
          { id: 'wamid.b', status: 'delivered', timestamp: '1790000001' },
          { id: 'wamid.c', status: 'read', timestamp: '1790000002' },
        ]),
      );

      expect(messagesService.applyDeliveryStatus).toHaveBeenCalledTimes(3);
      const estados = messagesService.applyDeliveryStatus.mock.calls.map(
        (c: any) => c[0].status,
      );
      expect(estados).toEqual(['SENT', 'DELIVERED', 'READ']);
    });

    it('convierte el timestamp de Meta (segundos) a Date', async () => {
      await service.processWebhook(
        statusPayload([
          { id: 'wamid.a', status: 'sent', timestamp: '1790000000' },
        ]),
      );

      const arg = messagesService.applyDeliveryStatus.mock.calls[0][0];
      expect(arg.occurredAt).toBeInstanceOf(Date);
      expect(arg.occurredAt.getTime()).toBe(1790000000 * 1000);
    });

    it('en failed conserva solo el clasificador y el titulo del error', async () => {
      await service.processWebhook(
        statusPayload([
          {
            id: 'wamid.f',
            status: 'failed',
            timestamp: '1790000003',
            errors: [
              {
                code: 131047,
                title: 'Re-engagement message',
                error_data: { details: 'no debe propagarse' },
              },
            ],
          },
        ]),
      );

      const arg = messagesService.applyDeliveryStatus.mock.calls[0][0];
      expect(arg.status).toBe('FAILED');
      expect(arg.errorCode).toBe('131047');
      expect(arg.errorMessage).toBe('Re-engagement message');
      // El payload crudo de Meta nunca se propaga.
      expect(JSON.stringify(arg)).not.toContain('no debe propagarse');
    });

    it('ignora un estado desconocido sin romper el lote', async () => {
      await service.processWebhook(
        statusPayload([
          { id: 'wamid.x', status: 'inventado' },
          { id: 'wamid.y', status: 'read', timestamp: '1790000004' },
        ]),
      );

      expect(messagesService.applyDeliveryStatus).toHaveBeenCalledTimes(1);
      expect(messagesService.applyDeliveryStatus.mock.calls[0][0].wamid).toBe(
        'wamid.y',
      );
    });

    it('un fallo al aplicar un estado no impide aplicar los demas', async () => {
      messagesService.applyDeliveryStatus
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValueOnce('updated');

      await expect(
        service.processWebhook(
          statusPayload([
            { id: 'wamid.a', status: 'sent', timestamp: '1790000000' },
            { id: 'wamid.b', status: 'read', timestamp: '1790000001' },
          ]),
        ),
      ).resolves.toBeUndefined();

      expect(messagesService.applyDeliveryStatus).toHaveBeenCalledTimes(2);
    });

    it('un payload de solo estados no crea contactos ni mensajes', async () => {
      await service.processWebhook(
        statusPayload([
          { id: 'wamid.a', status: 'delivered', timestamp: '1790000000' },
        ]),
      );

      expect(messagesService.create).not.toHaveBeenCalled();
      expect(contactsService.create).not.toHaveBeenCalled();
      expect(
        whatsappIntegrationService.findConnectedByPhoneNumberId,
      ).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // COLA DURABLE: el webhook debe hacer solo persistir + encolar. Meta exige
  // un ack rapido y reintenta si el handler tarda, asi que ejecutar los
  // efectos aqui dentro es lo que provoca reintentos y duplicados.
  // ─────────────────────────────────────────────────────────────
  describe('encolado de efectos', () => {
    beforeEach(() => {
      whatsappIntegrationService.findConnectedByPhoneNumberId.mockResolvedValue(
        connectedIntegration,
      );
      messagesService.findByWamid.mockResolvedValue(null);
      prisma.contact.findFirst.mockResolvedValue(null);
      contactsService.create.mockResolvedValue({ id: 'contact-a' });
      conversationsService.findOrCreate.mockResolvedValue({
        id: 'conversation-a',
      });
      messagesService.create.mockImplementation(
        async (_d: any, dentro?: any) => {
          const mensaje = { id: 'message-a' };
          if (dentro) await dentro({}, mensaje);
          return mensaje;
        },
      );
      automationsService.processMessage.mockResolvedValue(undefined);
    });

    it('encola los efectos con los datos del mensaje persistido', async () => {
      inboundQueue.enqueueInboundMessage.mockResolvedValue(true);
      messagesService.create.mockImplementation(
        async (_d: any, dentro?: any) => {
          const mensaje = { id: 'message-persistido' };
          if (dentro) await dentro({}, mensaje);
          return mensaje;
        },
      );

      await service.processWebhook(buildPayload());

      expect(inboundQueue.enqueueInboundMessage).toHaveBeenCalledTimes(1);
      const enviado = inboundQueue.enqueueInboundMessage.mock.calls[0][0];
      expect(enviado.messageId).toBe('message-persistido');
      expect(enviado.companyId).toBe('company-a');
    });

    it('cuando ENCOLA no ejecuta los efectos en linea', async () => {
      inboundQueue.enqueueInboundMessage.mockResolvedValue(true);

      await service.processWebhook(buildPayload());

      // Si ademas se ejecutaran aqui, cada mensaje dispararia sus efectos dos
      // veces: una en linea y otra en el worker.
      expect(automationsService.processMessage).not.toHaveBeenCalled();
    });

    it('cuando NO puede encolar NO ejecuta en linea: lo hara el dispatcher', async () => {
      inboundQueue.enqueueInboundMessage.mockResolvedValue(false);

      await service.processWebhook(buildPayload());

      // Un solo camino de ejecucion. El evento quedo en el outbox dentro de
      // la misma transaccion que el mensaje, asi que los efectos estan
      // garantizados; ejecutarlos tambien aqui los duplicaria si el enqueue
      // si habia llegado a Redis antes de fallar la respuesta.
      expect(automationsService.processMessage).not.toHaveBeenCalled();
      expect(outbox.markCompletedByKey).not.toHaveBeenCalled();
    });

    it('registra el evento de outbox DENTRO de la transaccion del mensaje', async () => {
      await service.processWebhook(buildPayload());

      // El callback se ejecuta dentro de messagesService.create: o se guardan
      // mensaje y evento, o no se guarda ninguno.
      expect(outbox.record).toHaveBeenCalledTimes(1);
      const registrado = outbox.record.mock.calls[0][1];
      expect(registrado.idempotencyKey).toBe('message-a');
      expect(registrado.companyId).toBe('company-a');
    });

    it('marca el evento completado cuando SI consiguio encolar', async () => {
      inboundQueue.enqueueInboundMessage.mockResolvedValue(true);

      await service.processWebhook(buildPayload());

      expect(outbox.markCompletedByKey).toHaveBeenCalledWith('message-a');
    });

    it('un fallo de la cola no impide persistir el mensaje', async () => {
      // El orden importa: primero se persiste, despues se encola. Si se
      // invirtiera, un fallo de Redis perderia el mensaje.
      inboundQueue.enqueueInboundMessage.mockResolvedValue(false);

      await service.processWebhook(buildPayload());

      expect(messagesService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('efectos del entrante: entrada al tablero', () => {
    beforeEach(() => {
      prisma.conversation.findFirst.mockResolvedValue({
        contactId: 'contact-a',
        contact: { name: 'Ana' },
      });
    });

    it('crea la oportunidad ANTES de avisar, para que el aviso tenga destinatario', async () => {
      // Era el agujero de fondo: WhatsApp funcionaba, el mensaje se guardaba,
      // y el tablero seguia vacio porque nadie llamaba nunca a lead.create.
      leadIntake.ensureLeadForConversation.mockResolvedValue({
        leadId: 'lead-1',
        creado: true,
        assignedTo: 'agente-1',
      });

      await service.runInboundEffects(
        'company-a',
        'conv-1',
        'hola',
        '+573001112233',
        null,
      );

      expect(leadIntake.ensureLeadForConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'company-a',
          contactId: 'contact-a',
          conversationId: 'conv-1',
        }),
      );
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserId: 'agente-1' }),
      );
    });

    it('la conversacion se busca acotada por companyId', async () => {
      // Aunque el trabajo venga de nuestra propia cola, no se confia en su
      // contenido para saltarse el aislamiento.
      await service.runInboundEffects('company-a', 'conv-1', 'hola', '+57300', null);

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1', companyId: 'company-a' },
        }),
      );
    });

    it('un asesor ya asignado a mano gana al reparto automatico', async () => {
      leadIntake.ensureLeadForConversation.mockResolvedValue({
        leadId: 'lead-1',
        creado: false,
        assignedTo: 'agente-del-reparto',
      });

      await service.runInboundEffects(
        'company-a',
        'conv-1',
        'hola',
        '+57300',
        'agente-que-la-tomo',
      );

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserId: 'agente-que-la-tomo' }),
      );
    });

    it('si la entrada al tablero falla, las automatizaciones siguen corriendo', async () => {
      // Preferimos un tablero incompleto a un mensaje sin procesar.
      leadIntake.ensureLeadForConversation.mockRejectedValue(
        new Error('base caida'),
      );

      await expect(
        service.runInboundEffects('company-a', 'conv-1', 'hola', '+57300', null),
      ).resolves.toBeUndefined();
      expect(automationsService.processMessage).toHaveBeenCalled();
    });

    it('sin conversacion no intenta crear oportunidad', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await service.runInboundEffects('company-a', 'conv-1', 'hola', '+57300', null);

      expect(leadIntake.ensureLeadForConversation).not.toHaveBeenCalled();
    });
  });
});
