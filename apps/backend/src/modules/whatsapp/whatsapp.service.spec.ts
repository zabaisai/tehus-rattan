import { readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppTokenCryptoService } from '../whatsapp-integration/whatsapp-token-crypto.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test-only key, never read from .env and never logged.
const TEST_ENCRYPTION_KEY = 'e2e-test-only-encryption-key-do-not-use';
// A fixture Graph API version — a test value, NOT a production default. The
// service has no hardcoded fallback (that is asserted below).
const TEST_GRAPH_VERSION = 'v20.0';

// Builds a WhatsappService with a controllable Graph API version.
function buildConfig(graphVersion: string | undefined) {
  return {
    get: jest.fn((key: string) => {
      if (key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY') return TEST_ENCRYPTION_KEY;
      if (key === 'WHATSAPP_GRAPH_API_VERSION') return graphVersion;
      return undefined;
    }),
  };
}

describe('WhatsappService', () => {
  let whatsappIntegrationService: any;
  let tokenCryptoService: WhatsAppTokenCryptoService;
  let service: WhatsappService;
  let connectedIntegration: any;

  beforeEach(() => {
    jest.clearAllMocks();

    whatsappIntegrationService = { findConnectedByCompanyId: jest.fn() };
    const configService = buildConfig(TEST_GRAPH_VERSION);
    tokenCryptoService = new WhatsAppTokenCryptoService(configService as any);

    connectedIntegration = {
      id: 'integration-a',
      companyId: 'company-a',
      phoneNumberId: '1234567890',
      accessTokenEncrypted: tokenCryptoService.encrypt('fake-meta-access-token'),
    };

    service = new WhatsappService(
      whatsappIntegrationService,
      tokenCryptoService,
      configService as any,
    );
  });

  it('sends the message using the tenant integration phoneNumberId and the decrypted token', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue(
      connectedIntegration,
    );
    mockedAxios.post.mockResolvedValue({ data: {} });

    await service.sendMessage('company-a', '50255551111', 'Hola');

    expect(
      whatsappIntegrationService.findConnectedByCompanyId,
    ).toHaveBeenCalledWith('company-a');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      `https://graph.facebook.com/${TEST_GRAPH_VERSION}/1234567890/messages`,
      {
        messaging_product: 'whatsapp',
        to: '50255551111',
        type: 'text',
        text: { body: 'Hola' },
      },
      {
        headers: {
          Authorization: 'Bearer fake-meta-access-token',
          'Content-Type': 'application/json',
        },
      },
    );
  });

  it('throws NotFoundException and never calls axios when there is no connected integration', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue(
      null,
    );

    await expect(
      service.sendMessage('company-b', '50255551111', 'Hola'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws NotFoundException and never calls axios when accessTokenEncrypted is missing', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue({
      ...connectedIntegration,
      accessTokenEncrypted: null,
    });

    await expect(
      service.sendMessage('company-a', '50255551111', 'Hola'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws BadRequestException and never calls axios when the token cannot be decrypted', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue({
      ...connectedIntegration,
      accessTokenEncrypted: 'not-a-valid-encrypted-token',
    });

    await expect(
      service.sendMessage('company-a', '50255551111', 'Hola'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns the WhatsApp message id (wamid) from a successful send', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue(
      connectedIntegration,
    );
    mockedAxios.post.mockResolvedValue({
      data: { messages: [{ id: 'wamid.HBgLABC123' }] },
    });

    const result = await service.sendMessage(
      'company-a',
      '50255551111',
      'Hola',
    );

    expect(result).toBe('wamid.HBgLABC123');
  });

  it('rethrows and logs a safe error (no token) when axios.post rejects', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue(
      connectedIntegration,
    );

    const axiosError = {
      isAxiosError: true,
      message: 'Request failed with status code 401',
      response: {
        status: 401,
        data: { error: { message: 'Invalid OAuth access token', code: 190 } },
      },
      config: {
        headers: { Authorization: 'Bearer fake-meta-access-token' },
      },
    };
    mockedAxios.post.mockRejectedValue(axiosError);
    mockedAxios.isAxiosError = jest.fn().mockReturnValue(true) as any;

    const errorSpy = jest.spyOn((service as any).logger, 'error');

    await expect(
      service.sendMessage('company-a', '50255551111', 'Hola'),
    ).rejects.toThrow(BadRequestException);

    expect(errorSpy).toHaveBeenCalled();
    const serialized = JSON.stringify(errorSpy.mock.calls.flat());
    expect(serialized).not.toContain('fake-meta-access-token');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).toContain('Invalid OAuth access token');
  });

  it('never logs the decrypted token, the encrypted token, or the Authorization header', async () => {
    whatsappIntegrationService.findConnectedByCompanyId.mockResolvedValue(
      connectedIntegration,
    );
    mockedAxios.post.mockResolvedValue({ data: {} });

    const logSpy = jest.spyOn((service as any).logger, 'log');
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    await service.sendMessage('company-a', '50255551111', 'Hola');

    const loggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();
    const serialized = JSON.stringify(loggedArgs);

    expect(serialized).not.toContain('fake-meta-access-token');
    expect(serialized).not.toContain(connectedIntegration.accessTokenEncrypted);
    expect(serialized).not.toContain('Bearer');
  });

  describe('Graph API version (no hardcoded fallback)', () => {
    function serviceWith(graphVersion: string | undefined) {
      const config = buildConfig(graphVersion);
      const crypto = new WhatsAppTokenCryptoService(config as any);
      const integrationSvc = { findConnectedByCompanyId: jest.fn() };
      integrationSvc.findConnectedByCompanyId.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
        phoneNumberId: '1234567890',
        accessTokenEncrypted: crypto.encrypt('fake-meta-access-token'),
      });
      return new WhatsappService(integrationSvc as any, crypto, config as any);
    }

    it('builds the URL from the configured version (a valid v<major>.<minor>)', async () => {
      const svc = serviceWith('v21.0');
      mockedAxios.post.mockResolvedValue({ data: {} });

      await svc.sendMessage('company-a', '50255551111', 'Hola');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/1234567890/messages',
        expect.anything(),
        expect.anything(),
      );
    });

    it('throws a controlled config error and never calls axios when the version is absent', async () => {
      const svc = serviceWith(undefined);

      await expect(
        svc.sendMessage('company-a', '50255551111', 'Hola'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('throws and never calls axios when the version has an invalid format', async () => {
      const svc = serviceWith('nineteen');

      await expect(
        svc.sendMessage('company-a', '50255551111', 'Hola'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('the controlled error never leaks the variable name or an internal value', async () => {
      const svc = serviceWith(undefined);
      try {
        await svc.sendMessage('company-a', '50255551111', 'Hola');
        fail('should have thrown');
      } catch (e) {
        const message = (e as Error).message;
        expect(message).toBe('WhatsApp no está configurado correctamente');
        expect(message).not.toContain('WHATSAPP_GRAPH_API_VERSION');
      }
    });

    it('has no hardcoded Graph API version literal in the service source', () => {
      const source = readFileSync(join(__dirname, 'whatsapp.service.ts'), 'utf8');
      expect(source).not.toContain('v19.0');
      expect(source).not.toMatch(/graph\.facebook\.com\/v\d/);
    });
  });
});
