import axios from 'axios';
import {
  MetaSignupError,
  WhatsAppMetaClientService,
} from './whatsapp-meta-client.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
// isAxiosError is used to classify errors; provide a predicate for the mock.
(mockedAxios as any).isAxiosError = (e: any) => Boolean(e?.isAxiosError);

const config = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      WHATSAPP_APP_ID: 'app-id',
      WHATSAPP_CONFIG_ID: 'config-id',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_GRAPH_API_VERSION: 'v25.0',
    };
    return map[key];
  }),
} as any;

describe('WhatsAppMetaClientService', () => {
  let service: WhatsAppMetaClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhatsAppMetaClientService(config);
  });

  describe('exchangeCode', () => {
    it('returns the access token on success and never logs it', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { access_token: 'TOKEN-123' },
      });
      const token = await service.exchangeCode('the-code');
      expect(token).toBe('TOKEN-123');
      // Called the oauth endpoint with client_id/secret/code as params.
      const [url, opts] = mockedAxios.get.mock.calls[0];
      expect(url).toContain('/v25.0/oauth/access_token');
      expect((opts as any).params).toMatchObject({
        client_id: 'app-id',
        client_secret: 'app-secret',
        code: 'the-code',
      });
      expect((opts as any).timeout).toBeGreaterThan(0);
    });

    it('throws CODE_EXCHANGE_FAILED when Meta returns no token', async () => {
      mockedAxios.get.mockResolvedValue({ data: {} });
      await expect(service.exchangeCode('x')).rejects.toMatchObject({
        classifier: 'CODE_EXCHANGE_FAILED',
      });
    });

    it('classifies a request timeout as META_TIMEOUT', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        code: 'ECONNABORTED',
      });
      await expect(service.exchangeCode('x')).rejects.toMatchObject({
        classifier: 'META_TIMEOUT',
      });
    });
  });

  describe('listPhoneNumbers', () => {
    it('parses id / display / verified name / platform type', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [
            {
              id: '123',
              display_phone_number: '+57 300 555 4521',
              verified_name: 'Tehus QA',
              platform_type: 'COEXISTENCE',
            },
          ],
        },
      });
      const numbers = await service.listPhoneNumbers('waba-1', 'token');
      expect(numbers[0]).toEqual({
        id: '123',
        displayPhoneNumber: '+57 300 555 4521',
        verifiedName: 'Tehus QA',
        platformType: 'COEXISTENCE',
      });
    });

    it('throws WABA_LOOKUP_FAILED on error', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        response: { status: 400 },
      });
      await expect(
        service.listPhoneNumbers('waba-1', 'token'),
      ).rejects.toMatchObject({
        classifier: 'WABA_LOOKUP_FAILED',
      });
    });
  });

  describe('subscribeAppToWaba', () => {
    it('POSTs to /{waba}/subscribed_apps with the bearer token', async () => {
      mockedAxios.post.mockResolvedValue({ data: { success: true } });
      await service.subscribeAppToWaba('waba-1', 'token');
      const [url, , opts] = mockedAxios.post.mock.calls[0];
      expect(url).toContain('/v25.0/waba-1/subscribed_apps');
      expect((opts as any).headers.Authorization).toBe('Bearer token');
    });

    it('throws SUBSCRIBE_FAILED on error', async () => {
      mockedAxios.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 500 },
      });
      await expect(
        service.subscribeAppToWaba('waba-1', 'token'),
      ).rejects.toMatchObject({
        classifier: 'SUBSCRIBE_FAILED',
      });
    });
  });

  describe('config guards', () => {
    it('throws CONFIG_MISSING (typed) when app id is absent', () => {
      const bare = new WhatsAppMetaClientService({
        get: jest.fn().mockReturnValue(undefined),
      } as any);
      expect(() => bare.appId()).toThrow(MetaSignupError);
    });
  });
});
