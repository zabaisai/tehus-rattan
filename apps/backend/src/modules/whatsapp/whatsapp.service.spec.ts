import axios from 'axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { WhatsappService } from './whatsapp.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test-only key, never read from .env and never logged.
const TEST_ENCRYPTION_KEY = 'e2e-test-only-encryption-key-do-not-use';

// Mirrors WhatsappService's private decryptAccessToken format so tests can
// build valid fixtures: "<ivHex>:<authTagHex>:<cipherTextHex>",
// AES-256-GCM with a 12-byte IV, key = sha256(rawKey).
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

describe('WhatsappService', () => {
  let whatsappIntegrationService: any;
  let configService: any;
  let service: WhatsappService;

  const connectedIntegration = {
    id: 'integration-a',
    companyId: 'company-a',
    phoneNumberId: '1234567890',
    accessTokenEncrypted: encryptForTest(
      'fake-meta-access-token',
      TEST_ENCRYPTION_KEY,
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    whatsappIntegrationService = { findConnectedByCompanyId: jest.fn() };
    configService = {
      get: jest.fn((key: string) =>
        key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY'
          ? TEST_ENCRYPTION_KEY
          : undefined,
      ),
    };

    service = new WhatsappService(whatsappIntegrationService, configService);
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
