import axios from 'axios';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { WhatsAppIntegrationService } from './whatsapp-integration/whatsapp-integration.service';
import { WebhookService } from './webhook/webhook.service';
import { WhatsappService } from './whatsapp/whatsapp.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test-only key, never read from .env and never logged.
const TEST_ENCRYPTION_KEY = 'tenant-isolation-test-only-key-do-not-use';

// Mirrors WhatsappService's private decryptAccessToken format:
// "<ivHex>:<authTagHex>:<cipherTextHex>", AES-256-GCM, key = sha256(rawKey).
function encryptForTest(plainToken: string, rawKey: string): string {
  const key = createHash('sha256').update(rawKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainToken, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

const integrationA = {
  id: 'integration-a',
  companyId: 'company-a',
  phoneNumberId: 'phone-a',
  displayPhoneNumber: '+50255550001',
  wabaId: 'waba-a',
  status: 'CONNECTED',
  accessTokenEncrypted: encryptForTest('token-a', TEST_ENCRYPTION_KEY),
};

const integrationB = {
  id: 'integration-b',
  companyId: 'company-b',
  phoneNumberId: 'phone-b',
  displayPhoneNumber: '+50255550002',
  wabaId: 'waba-b',
  status: 'CONNECTED',
  accessTokenEncrypted: encryptForTest('token-b', TEST_ENCRYPTION_KEY),
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
      whatsappIntegrationService = new WhatsAppIntegrationService(prisma);
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
      automationsService = { processMessage: jest.fn().mockResolvedValue(undefined) };

      webhookService = new WebhookService(
        prisma,
        conversationsService,
        messagesService,
        contactsService,
        automationsService,
        whatsappIntegrationService,
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
    let configService: any;
    let service: WhatsappService;

    beforeEach(() => {
      jest.clearAllMocks();

      const prisma = buildFakePrisma([integrationA, integrationB]);
      whatsappIntegrationService = new WhatsAppIntegrationService(prisma);
      configService = {
        get: jest.fn((key: string) =>
          key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY'
            ? TEST_ENCRYPTION_KEY
            : undefined,
        ),
      };
      service = new WhatsappService(whatsappIntegrationService, configService);

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
      expect(options.headers.Authorization).not.toBe('Bearer token-b');
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
      expect(options.headers.Authorization).not.toBe('Bearer token-a');
    });
  });
});
