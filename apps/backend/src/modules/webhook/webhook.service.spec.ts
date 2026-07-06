import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let prisma: any;
  let conversationsService: any;
  let messagesService: any;
  let contactsService: any;
  let automationsService: any;
  let whatsappIntegrationService: any;
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
    prisma = { contact: { findFirst: jest.fn() } };
    conversationsService = { findOrCreate: jest.fn() };
    messagesService = { findByWamid: jest.fn(), create: jest.fn() };
    contactsService = { create: jest.fn() };
    automationsService = { processMessage: jest.fn() };
    whatsappIntegrationService = { findConnectedByPhoneNumberId: jest.fn() };

    service = new WebhookService(
      prisma,
      conversationsService,
      messagesService,
      contactsService,
      automationsService,
      whatsappIntegrationService,
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
    messagesService.create.mockResolvedValue({ id: 'message-a' });
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
    );
    expect(automationsService.processMessage).toHaveBeenCalledWith(
      'company-a',
      'conversation-a',
      'Hola',
      '50255551111',
    );

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
});
