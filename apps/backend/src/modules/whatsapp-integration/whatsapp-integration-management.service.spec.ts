import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';

// Test-only key, never read from .env and never logged.
const TEST_KEY = 'management-service-test-only-key-do-not-use';

const validInput = {
  phoneNumberId: 'phone-a',
  accessToken: 'plain-meta-token',
  displayPhoneNumber: '+50255550000',
  wabaId: 'waba-a',
};

describe('WhatsAppIntegrationManagementService', () => {
  let prisma: any;
  let tokenCryptoService: WhatsAppTokenCryptoService;
  let service: WhatsAppIntegrationManagementService;

  beforeEach(() => {
    prisma = {
      whatsAppIntegration: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY' ? TEST_KEY : undefined,
      ),
    };
    tokenCryptoService = new WhatsAppTokenCryptoService(configService as any);

    service = new WhatsAppIntegrationManagementService(
      prisma,
      tokenCryptoService,
    );
  });

  describe('getForCompany', () => {
    it('returns a safe response without accessTokenEncrypted', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
        displayPhoneNumber: '+50255550000',
        phoneNumberId: 'phone-a',
        wabaId: 'waba-a',
        status: 'CONNECTED',
        accessTokenEncrypted: tokenCryptoService.encrypt('secret-token'),
        connectedAt: new Date('2026-01-01'),
        disconnectedAt: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      });

      const result = await service.getForCompany('company-a');

      expect(prisma.whatsAppIntegration.findUnique).toHaveBeenCalledWith({
        where: { companyId: 'company-a' },
      });
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result?.phoneNumberId).toBe('phone-a');
    });

    it('returns null when there is no integration for the company', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue(null);

      const result = await service.getForCompany('company-b');

      expect(result).toBeNull();
    });

    it('rejects a blank or whitespace-only companyId', async () => {
      await expect(service.getForCompany('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.whatsAppIntegration.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('connectOrUpdateForCompany', () => {
    it('creates a new integration: encrypts the token, sets CONNECTED, connectedAt, clears disconnectedAt, and returns a safe response', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue(null);
      prisma.whatsAppIntegration.upsert.mockImplementation(
        ({ create }: any) =>
          Promise.resolve({ id: 'integration-a', ...create }),
      );

      const result = await service.connectOrUpdateForCompany(
        'company-a',
        validInput,
      );

      expect(prisma.whatsAppIntegration.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.whatsAppIntegration.upsert.mock.calls[0][0];

      expect(call.where).toEqual({ companyId: 'company-a' });
      expect(call.create.companyId).toBe('company-a');
      expect(call.create.phoneNumberId).toBe('phone-a');
      expect(call.create.status).toBe('CONNECTED');
      expect(call.create.connectedAt).toBeInstanceOf(Date);
      expect(call.create.disconnectedAt).toBeNull();

      expect(call.create.accessTokenEncrypted).not.toBe('plain-meta-token');
      expect(
        tokenCryptoService.decrypt(call.create.accessTokenEncrypted),
      ).toBe('plain-meta-token');

      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('updates an existing integration by companyId', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue(null);
      prisma.whatsAppIntegration.upsert.mockImplementation(
        ({ update }: any) =>
          Promise.resolve({
            id: 'integration-a',
            companyId: 'company-a',
            ...update,
          }),
      );

      await service.connectOrUpdateForCompany('company-a', validInput);

      const call = prisma.whatsAppIntegration.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ companyId: 'company-a' });
      expect(call.update.phoneNumberId).toBe('phone-a');
      expect(call.update.status).toBe('CONNECTED');
      expect(call.update.disconnectedAt).toBeNull();
    });

    it('rejects a blank companyId', async () => {
      await expect(
        service.connectOrUpdateForCompany('   ', validInput),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects a blank or whitespace-only phoneNumberId', async () => {
      await expect(
        service.connectOrUpdateForCompany('company-a', {
          ...validInput,
          phoneNumberId: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects a blank or whitespace-only accessToken', async () => {
      await expect(
        service.connectOrUpdateForCompany('company-a', {
          ...validInput,
          accessToken: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('throws ConflictException when phoneNumberId already belongs to another company', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        companyId: 'company-b',
      });

      await expect(
        service.connectOrUpdateForCompany('company-a', validInput),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('allows a company to reconnect using the phoneNumberId it already owns', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        companyId: 'company-a',
      });
      prisma.whatsAppIntegration.upsert.mockImplementation(
        ({ update }: any) =>
          Promise.resolve({
            id: 'integration-a',
            companyId: 'company-a',
            ...update,
          }),
      );

      await expect(
        service.connectOrUpdateForCompany('company-a', validInput),
      ).resolves.not.toThrow();

      expect(prisma.whatsAppIntegration.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnectForCompany', () => {
    it('sets status to DISCONNECTED and disconnectedAt', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
      });
      prisma.whatsAppIntegration.update.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'integration-a',
          companyId: 'company-a',
          phoneNumberId: 'phone-a',
          displayPhoneNumber: null,
          wabaId: null,
          accessTokenEncrypted: 'still-here-encrypted',
          createdAt: new Date(),
          updatedAt: new Date(),
          connectedAt: new Date(),
          ...data,
        }),
      );

      const result = await service.disconnectForCompany('company-a');

      const call = prisma.whatsAppIntegration.update.mock.calls[0][0];
      expect(call.where).toEqual({ companyId: 'company-a' });
      expect(call.data.status).toBe('DISCONNECTED');
      expect(call.data.disconnectedAt).toBeInstanceOf(Date);
      expect(result.status).toBe('DISCONNECTED');
    });

    it('never calls delete and only updates the row', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
      });
      prisma.whatsAppIntegration.update.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
        phoneNumberId: 'phone-a',
        displayPhoneNumber: null,
        wabaId: null,
        status: 'DISCONNECTED',
        connectedAt: null,
        disconnectedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.disconnectForCompany('company-a');

      expect(prisma.whatsAppIntegration.delete).toBeUndefined();
      expect(prisma.whatsAppIntegration.update).toHaveBeenCalledTimes(1);
    });

    it('returns a safe response without accessTokenEncrypted', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
      });
      prisma.whatsAppIntegration.update.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
        phoneNumberId: 'phone-a',
        displayPhoneNumber: null,
        wabaId: null,
        status: 'DISCONNECTED',
        accessTokenEncrypted: 'still-encrypted-value',
        connectedAt: null,
        disconnectedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.disconnectForCompany('company-a');

      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('throws NotFoundException when there is no integration for the company', async () => {
      prisma.whatsAppIntegration.findUnique.mockResolvedValue(null);

      await expect(
        service.disconnectForCompany('company-a'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.whatsAppIntegration.update).not.toHaveBeenCalled();
    });
  });

  describe('safety', () => {
    it('never logs the plain or encrypted access token during any operation', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      prisma.whatsAppIntegration.findUnique.mockResolvedValue(null);
      prisma.whatsAppIntegration.upsert.mockImplementation(
        ({ create }: any) =>
          Promise.resolve({ id: 'integration-a', ...create }),
      );
      prisma.whatsAppIntegration.update.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
        phoneNumberId: 'phone-a',
        displayPhoneNumber: null,
        wabaId: null,
        status: 'DISCONNECTED',
        connectedAt: null,
        disconnectedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.connectOrUpdateForCompany('company-a', validInput);
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        id: 'integration-a',
        companyId: 'company-a',
      });
      await service.getForCompany('company-a');
      await service.disconnectForCompany('company-a');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
