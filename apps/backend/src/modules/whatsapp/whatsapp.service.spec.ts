import axios from 'axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppTokenCryptoService } from '../whatsapp-integration/whatsapp-token-crypto.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test-only key, never read from .env and never logged.
const TEST_ENCRYPTION_KEY = 'e2e-test-only-encryption-key-do-not-use';

describe('WhatsappService', () => {
  let whatsappIntegrationService: any;
  let tokenCryptoService: WhatsAppTokenCryptoService;
  let service: WhatsappService;
  let connectedIntegration: any;

  beforeEach(() => {
    jest.clearAllMocks();

    whatsappIntegrationService = { findConnectedByCompanyId: jest.fn() };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY'
          ? TEST_ENCRYPTION_KEY
          : undefined,
      ),
    };
    tokenCryptoService = new WhatsAppTokenCryptoService(configService as any);

    connectedIntegration = {
      id: 'integration-a',
      companyId: 'company-a',
      phoneNumberId: '1234567890',
      accessTokenEncrypted: tokenCryptoService.encrypt('fake-meta-access-token'),
    };

    service = new WhatsappService(whatsappIntegrationService, tokenCryptoService);
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
      'https://graph.facebook.com/v19.0/1234567890/messages',
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
});
