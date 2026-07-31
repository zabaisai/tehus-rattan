import axios from 'axios';
import { WhatsAppIntegrationService } from './whatsapp-integration/whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from './whatsapp-integration/whatsapp-token-crypto.service';
import { WebhookService } from './webhook/webhook.service';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test-only key, never read from .env and never logged.
const TEST_ENCRYPTION_KEY = 'tenant-isolation-test-only-key-do-not-use';

// Shared real crypto service (mocked ConfigService only) used to build
// fixtures below and to construct WhatsappService in the outbound tests,
// so this file doesn't duplicate the encryption algorithm.
const tokenCryptoConfigService = {
  get: jest.fn((key: string) =>
    key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY' ? TEST_ENCRYPTION_KEY : undefined,
  ),
};
const tokenCryptoService = new WhatsAppTokenCryptoService(
  tokenCryptoConfigService as any,
);

const integrationA = {
  id: 'integration-a',
  companyId: 'company-a',
  phoneNumberId: 'phone-a',
  displayPhoneNumber: '+50255550001',
  wabaId: 'waba-a',
  status: 'CONNECTED',
  accessTokenEncrypted: tokenCryptoService.encrypt('token-a'),
};

const integrationB = {
  id: 'integration-b',
  companyId: 'company-b',
  phoneNumberId: 'phone-b',
  displayPhoneNumber: '+50255550002',
  wabaId: 'waba-b',
  status: 'CONNECTED',
  accessTokenEncrypted: tokenCryptoService.encrypt('token-b'),
};

// Fake Prisma holding both companies' integrations at once, filtering
// findFirst by where.phoneNumberId / where.companyId / where.status, and
// honoring `select` the same way Prisma would (projects only chosen keys).
function buildFakePrisma(integrations: any[]) {
  return {
    whatsAppIntegration: {
      findFirst: jest.fn(({ where, select }: any) => {
        const match = integrations.find((integration) => {
          if (
            where.phoneNumberId !== undefined &&
            integration.phoneNumberId !== where.phoneNumberId
          )
            return false;
          if (
            where.companyId !== undefined &&
            integration.companyId !== where.companyId
          )
            return false;
          if (where.status !== undefined && integration.status !== where.status)
            return false;
          return true;
        });

        if (!match) return Promise.resolve(null);
        if (!select) return Promise.resolve({ ...match });

        const projected: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) projected[key] = match[key];
        }
        return Promise.resolve(projected);
      }),
    },
    contact: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

describe('WhatsApp tenant isolation (Company A vs Company B)', () => {
  describe('WhatsAppIntegrationService', () => {
    let service: WhatsAppIntegrationService;

    beforeEach(() => {
      const prisma = buildFakePrisma([integrationA, integrationB]);
      service = new WhatsAppIntegrationService(prisma as any);
    });

    it('findConnectedByPhoneNumberId returns only the matching company integration', async () => {
      const resultA = await service.findConnectedByPhoneNumberId('phone-a');
      const resultB = await service.findConnectedByPhoneNumberId('phone-b');

      expect(resultA?.companyId).toBe('company-a');
      expect(resultB?.companyId).toBe('company-b');
      expect(resultA?.companyId).not.toBe('company-b');
      expect(resultB?.companyId).not.toBe('company-a');
    });

    it('findConnectedByCompanyId returns only the matching company integration', async () => {
      const resultA = await service.findConnectedByCompanyId('company-a');
      const resultB = await service.findConnectedByCompanyId('company-b');

      expect(resultA?.phoneNumberId).toBe('phone-a');
      expect(resultA?.accessTokenEncrypted).toBe(
        integrationA.accessTokenEncrypted,
      );
      expect(resultB?.phoneNumberId).toBe('phone-b');
      expect(resultB?.accessTokenEncrypted).toBe(
        integrationB.accessTokenEncrypted,
      );

      expect(resultA?.accessTokenEncrypted).not.toBe(
        integrationB.accessTokenEncrypted,
      );
      expect(resultB?.accessTokenEncrypted).not.toBe(
        integrationA.accessTokenEncrypted,
      );
    });
  });

  describe('Inbound: WebhookService', () => {
    let prisma: any;
    let whatsappIntegrationService: WhatsAppIntegrationService;
    let conversationsService: any;
    let messagesService: any;
    let contactsService: any;
    let automationsService: any;
    let webhookService: WebhookService;

    const buildPayload = (phoneNumberId: string, wamid: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Jane Doe' } }],
                messages: [
                  { id: wamid, from: '50255551111', text: { body: 'Hola' } },
                ],
              },
            },
          ],
        },
      ],
    });

    beforeEach(() => {
      prisma = buildFakePrisma([integrationA, integrationB]);
      // El doble solo implementa lo que este servicio consulta. La asercion
      // dice exactamente eso: es un Prisma parcial a proposito, no un
      // descuido.
      whatsappIntegrationService = new WhatsAppIntegrationService(
        prisma as unknown as PrismaService,
      );
      conversationsService = {
        findOrCreate: jest.fn().mockResolvedValue({ id: 'conversation-x' }),
      };
      messagesService = {
        findByWamid: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'message-x' }),
      };
      contactsService = {
        create: jest.fn().mockResolvedValue({ id: 'contact-x' }),
      };
      automationsService = {
        processMessage: jest.fn().mockResolvedValue(undefined),
      };

      // Los diez argumentos van nombrados y en orden. Antes faltaban dos y
      // los mocks quedaban DESPLAZADOS: la cola aterrizaba en la posicion de
      // las notificaciones y el outbox en la de la cola. Las pruebas seguian
      // pasando porque no llegaban a esos caminos, que es justo lo que hace
      // peligroso este tipo de desajuste.
      const notificationsMock = {
        emit: jest.fn().mockResolvedValue(undefined),
        emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
      } as never;
      const inboundQueueMock = {
        enqueueInboundMessage: jest.fn().mockResolvedValue(false),
        isEnabled: jest.fn().mockReturnValue(false),
      } as never;
      const outboxMock = {
        record: jest.fn().mockResolvedValue(true),
        markCompletedByKey: jest.fn().mockResolvedValue(undefined),
      } as never;
      const leadIntakeMock = {
        ensureLeadForConversation: jest
          .fn()
          .mockResolvedValue({ leadId: null, creado: false, assignedTo: null }),
      } as never;
      // El bot no atiende: estas pruebas cubren el enrutado por empresa, y un
      // bot activo se comeria los mensajes antes de llegar a lo que se mide.
      const chatbotMock = {
        handleInbound: jest
          .fn()
          .mockResolvedValue({ atendido: false, motivo: 'sin-flujo' }),
      } as never;

      // El historial de coexistencia no participa aqui: llega por otro campo
      // del webhook y no dispara efectos.
      const historySyncMock = {
        procesarHistorial: jest.fn().mockResolvedValue({
          recibidos: 0,
          importados: 0,
          duplicados: 0,
          descartados: 0,
        }),
      } as never;

      webhookService = new WebhookService(
        prisma,
        conversationsService,
        messagesService,
        contactsService,
        automationsService,
        whatsappIntegrationService,
        notificationsMock,
        inboundQueueMock,
        outboxMock,
        leadIntakeMock,
        chatbotMock,
        historySyncMock,
      );
    });

    it('routes a webhook from Company A phoneNumberId only to Company A data', async () => {
      await webhookService.processWebhook(buildPayload('phone-a', 'wamid.a1'));

      expect(contactsService.create).toHaveBeenCalledWith(
        'company-a',
        expect.anything(),
      );
      expect(conversationsService.findOrCreate).toHaveBeenCalledWith(
        'company-a',
        'contact-x',
      );
      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-a' }),
        // Segundo argumento: el callback del outbox.
        expect.any(Function),
      );

      expect(contactsService.create).not.toHaveBeenCalledWith(
        'company-b',
        expect.anything(),
      );
      expect(conversationsService.findOrCreate).not.toHaveBeenCalledWith(
        'company-b',
        expect.anything(),
      );
      expect(messagesService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-b' }),
      );
    });

    it('routes a webhook from Company B phoneNumberId only to Company B data', async () => {
      await webhookService.processWebhook(buildPayload('phone-b', 'wamid.b1'));

      expect(contactsService.create).toHaveBeenCalledWith(
        'company-b',
        expect.anything(),
      );
      expect(conversationsService.findOrCreate).toHaveBeenCalledWith(
        'company-b',
        'contact-x',
      );
      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-b' }),
        // Segundo argumento: el callback del outbox.
        expect.any(Function),
      );

      expect(contactsService.create).not.toHaveBeenCalledWith(
        'company-a',
        expect.anything(),
      );
      expect(conversationsService.findOrCreate).not.toHaveBeenCalledWith(
        'company-a',
        expect.anything(),
      );
      expect(messagesService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-a' }),
      );
    });
  });

  describe('Outbound: WhatsappService', () => {
    let whatsappIntegrationService: WhatsAppIntegrationService;
    let service: WhatsappService;

    beforeEach(() => {
      jest.clearAllMocks();

      const prisma = buildFakePrisma([integrationA, integrationB]);
      // Doble parcial a proposito: solo implementa lo que este servicio
      // consulta. La asercion lo dice explicitamente en vez de dejar un
      // error de tipos abierto.
      whatsappIntegrationService = new WhatsAppIntegrationService(
        prisma as unknown as PrismaService,
      );
      service = new WhatsappService(
        whatsappIntegrationService,
        tokenCryptoService,
        // Fixture Graph API version (a test value, not a production default);
        // the service has no hardcoded fallback.
        {
          get: (key: string) =>
            key === 'WHATSAPP_GRAPH_API_VERSION' ? 'v20.0' : undefined,
        } as any,
      );

      mockedAxios.post.mockResolvedValue({ data: {} });
    });

    it('sends via Company A integration using phone-a and token-a only', async () => {
      await service.sendMessage('company-a', '50255551111', 'Hola A');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('phone-a'),
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-a',
          }),
        }),
      );

      const [url, , options] = mockedAxios.post.mock.calls[0];
      expect(url).not.toContain('phone-b');
      // Se afirma que la cabecera EXISTE antes de mirarla: si la llamada
      // llegara sin opciones, un acceso opcional daria `undefined` y la
      // comparacion pasaria sola sin haber comprobado nada.
      expect(options?.headers?.Authorization).toBeDefined();
      expect(options?.headers?.Authorization).not.toBe('Bearer token-b');
    });

    it('sends via Company B integration using phone-b and token-b only', async () => {
      await service.sendMessage('company-b', '50255552222', 'Hola B');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('phone-b'),
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-b',
          }),
        }),
      );

      const [url, , options] = mockedAxios.post.mock.calls[0];
      expect(url).not.toContain('phone-a');
      expect(options?.headers?.Authorization).toBeDefined();
      expect(options?.headers?.Authorization).not.toBe('Bearer token-a');
    });
  });
});
