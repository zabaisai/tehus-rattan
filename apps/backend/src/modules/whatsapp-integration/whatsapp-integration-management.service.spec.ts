import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import { MetaSignupError } from './whatsapp-meta-client.service';

// Test-only key, never read from .env and never logged.
const TEST_KEY = 'management-service-test-only-key-do-not-use';

const validInput = {
  phoneNumberId: 'phone-a',
  accessToken: 'plain-meta-token',
  displayPhoneNumber: '+50255550000',
  wabaId: 'waba-a',
};

// Fictitious actor — no real user, no real IP.
const actor = {
  userId: 'user-1',
  role: 'SUPER_ADMIN' as any,
  ipPreview: '203.0.113.x',
  userAgent: 'jest',
};

describe('WhatsAppIntegrationManagementService', () => {
  let prisma: any;
  let tokenCryptoService: WhatsAppTokenCryptoService;
  let metaClient: any;
  let auditLog: any;
  let service: WhatsAppIntegrationManagementService;

  beforeEach(() => {
    prisma = {
      whatsAppIntegration: {
        // findFirst resuelve la integracion PRINCIPAL (modelo 1:N).
        findFirst: jest.fn().mockResolvedValue(null),
        // findUnique sigue usandose para claves realmente unicas.
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      // Runs the callback with the same mock client, so upsert + audit are
      // observed exactly as they happen inside the real transaction.
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY' ? TEST_KEY : undefined,
      ),
    };
    tokenCryptoService = new WhatsAppTokenCryptoService(configService as any);

    // Meta is ALWAYS mocked here — these tests never touch the network.
    metaClient = {
      listPhoneNumbers: jest.fn().mockResolvedValue([
        {
          id: 'phone-a',
          displayPhoneNumber: '+50255550000',
          verifiedName: 'QA Test Business',
        },
      ]),
      subscribeAppToWaba: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new WhatsAppIntegrationManagementService(
      prisma,
      tokenCryptoService,
      metaClient,
      auditLog,
    );
  });

  describe('getForCompany', () => {
    it('returns a safe response without accessTokenEncrypted', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
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

      // 1:N: la empresa puede tener varios numeros, asi que se resuelve el
      // PRINCIPAL con desempate explicito en vez de findUnique por companyId.
      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-a' },
        orderBy: [
          { isPrimary: 'desc' },
          { order: 'asc' },
          { createdAt: 'asc' },
        ],
      });
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result?.phoneNumberId).toBe('phone-a');
    });

    it('returns null when there is no integration for the company', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      const result = await service.getForCompany('company-b');

      expect(result).toBeNull();
    });

    it('rejects a blank or whitespace-only companyId', async () => {
      await expect(service.getForCompany('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.whatsAppIntegration.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('connectOrUpdateForCompany', () => {
    it('creates a new integration: encrypts the token, sets CONNECTED, connectedAt, clears disconnectedAt, and returns a safe response', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);
      prisma.whatsAppIntegration.upsert.mockImplementation(({ create }: any) =>
        Promise.resolve({ id: 'integration-a', ...create }),
      );

      const result = await service.connectOrUpdateForCompany(
        'company-a',
        validInput,
        actor,
      );

      expect(prisma.whatsAppIntegration.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.whatsAppIntegration.upsert.mock.calls[0][0];

      // Clave por phoneNumberId (unico global), no por empresa.
      expect(call.where).toEqual({ phoneNumberId: 'phone-a' });
      expect(call.create.companyId).toBe('company-a');
      expect(call.create.phoneNumberId).toBe('phone-a');
      expect(call.create.status).toBe('CONNECTED');
      expect(call.create.connectedAt).toBeInstanceOf(Date);
      expect(call.create.disconnectedAt).toBeNull();

      expect(call.create.accessTokenEncrypted).not.toBe('plain-meta-token');
      expect(tokenCryptoService.decrypt(call.create.accessTokenEncrypted)).toBe(
        'plain-meta-token',
      );

      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('updates an existing integration by companyId', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);
      prisma.whatsAppIntegration.upsert.mockImplementation(({ update }: any) =>
        Promise.resolve({
          id: 'integration-a',
          companyId: 'company-a',
          ...update,
        }),
      );

      await service.connectOrUpdateForCompany('company-a', validInput, actor);

      const call = prisma.whatsAppIntegration.upsert.mock.calls[0][0];
      // Clave por phoneNumberId (unico global), no por empresa.
      expect(call.where).toEqual({ phoneNumberId: 'phone-a' });
      expect(call.update.phoneNumberId).toBe('phone-a');
      expect(call.update.status).toBe('CONNECTED');
      expect(call.update.disconnectedAt).toBeNull();
    });

    it('rejects a blank companyId', async () => {
      await expect(
        service.connectOrUpdateForCompany('   ', validInput, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects a blank or whitespace-only phoneNumberId', async () => {
      await expect(
        service.connectOrUpdateForCompany(
          'company-a',
          { ...validInput, phoneNumberId: '   ' },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects a blank or whitespace-only accessToken', async () => {
      await expect(
        service.connectOrUpdateForCompany(
          'company-a',
          { ...validInput, accessToken: '   ' },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects a blank or whitespace-only wabaId', async () => {
      await expect(
        service.connectOrUpdateForCompany(
          'company-a',
          { ...validInput, wabaId: '   ' },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(metaClient.listPhoneNumbers).not.toHaveBeenCalled();
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('throws ConflictException when phoneNumberId already belongs to another company, without calling Meta', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
        companyId: 'company-b',
      });

      await expect(
        service.connectOrUpdateForCompany('company-a', validInput, actor),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(metaClient.listPhoneNumbers).not.toHaveBeenCalled();
      expect(metaClient.subscribeAppToWaba).not.toHaveBeenCalled();
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the WABA already belongs to another company', async () => {
      // First guard (phoneNumberId) clean, second guard (wabaId) owned by B.
      prisma.whatsAppIntegration.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ companyId: 'company-b' });

      await expect(
        service.connectOrUpdateForCompany('company-a', validInput, actor),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(metaClient.subscribeAppToWaba).not.toHaveBeenCalled();
      expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
    });

    it('allows a company to reconnect using the phoneNumberId it already owns', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
        companyId: 'company-a',
      });
      prisma.whatsAppIntegration.upsert.mockImplementation(({ update }: any) =>
        Promise.resolve({
          id: 'integration-a',
          companyId: 'company-a',
          ...update,
        }),
      );

      await expect(
        service.connectOrUpdateForCompany('company-a', validInput, actor),
      ).resolves.not.toThrow();

      expect(prisma.whatsAppIntegration.upsert).toHaveBeenCalledTimes(1);
    });

    describe('Meta validation before persisting (Meta always mocked)', () => {
      it('validates the phoneNumberId against the WABA and subscribes the app, in that order', async () => {
        prisma.whatsAppIntegration.upsert.mockImplementation(
          ({ create }: any) =>
            Promise.resolve({ id: 'integration-a', ...create }),
        );

        await service.connectOrUpdateForCompany('company-a', validInput, actor);

        expect(metaClient.listPhoneNumbers).toHaveBeenCalledWith(
          'waba-a',
          'plain-meta-token',
        );
        expect(metaClient.subscribeAppToWaba).toHaveBeenCalledWith(
          'waba-a',
          'plain-meta-token',
        );
        expect(
          metaClient.listPhoneNumbers.mock.invocationCallOrder[0],
        ).toBeLessThan(
          metaClient.subscribeAppToWaba.mock.invocationCallOrder[0],
        );
      });

      it('rejects an invalid/expired token (Meta lookup fails) and writes nothing', async () => {
        metaClient.listPhoneNumbers.mockRejectedValue(
          new MetaSignupError('WABA_LOOKUP_FAILED'),
        );

        await expect(
          service.connectOrUpdateForCompany('company-a', validInput, actor),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(metaClient.subscribeAppToWaba).not.toHaveBeenCalled();
        expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
        expect(auditLog.record).not.toHaveBeenCalled();
      });

      it('rejects a phoneNumberId that does not belong to the given WABA and writes nothing', async () => {
        metaClient.listPhoneNumbers.mockResolvedValue([
          { id: 'some-other-phone' },
        ]);

        await expect(
          service.connectOrUpdateForCompany('company-a', validInput, actor),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(metaClient.subscribeAppToWaba).not.toHaveBeenCalled();
        expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
      });

      it('does not persist when the WABA subscription fails', async () => {
        metaClient.subscribeAppToWaba.mockRejectedValue(
          new MetaSignupError('SUBSCRIBE_FAILED'),
        );

        await expect(
          service.connectOrUpdateForCompany('company-a', validInput, actor),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.whatsAppIntegration.upsert).not.toHaveBeenCalled();
      });

      it('never leaks the token in the error surfaced to the caller', async () => {
        metaClient.listPhoneNumbers.mockRejectedValue(
          new MetaSignupError('WABA_LOOKUP_FAILED'),
        );

        await expect(
          service.connectOrUpdateForCompany('company-a', validInput, actor),
        ).rejects.toThrow(
          expect.not.stringContaining('plain-meta-token') as never,
        );
      });
    });

    describe('audit', () => {
      beforeEach(() => {
        prisma.whatsAppIntegration.upsert.mockImplementation(
          ({ create }: any) =>
            Promise.resolve({ id: 'integration-a', ...create }),
        );
      });

      it('records WHATSAPP_MANUAL_CONNECTED inside the same transaction', async () => {
        await service.connectOrUpdateForCompany('company-a', validInput, actor);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(auditLog.record).toHaveBeenCalledTimes(1);
        const [writer, entry] = auditLog.record.mock.calls[0];
        // Same client the upsert ran on: a failed audit rolls the write back.
        expect(writer).toBe(prisma);
        expect(entry.action).toBe('WHATSAPP_MANUAL_CONNECTED');
        expect(entry.affectedCompanyId).toBe('company-a');
        expect(entry.actorUserId).toBe('user-1');
        expect(entry.entityId).toBe('integration-a');
      });

      it('never stores the plain or encrypted token in the audit entry', async () => {
        await service.connectOrUpdateForCompany('company-a', validInput, actor);

        const serialized = JSON.stringify(auditLog.record.mock.calls[0][1]);
        expect(serialized).not.toContain('plain-meta-token');
        expect(serialized).not.toContain('accessToken');
      });
    });
  });

  describe('disconnectForCompany', () => {
    it('sets status to DISCONNECTED and disconnectedAt', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
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
      // Desconectar actua sobre la fila YA resuelta (la principal), asi que
      // la clave es su id: con varios numeros, `companyId` ya no identifica
      // una unica integracion.
      expect(call.where).toEqual({ id: 'integration-a' });
      expect(call.data.status).toBe('DISCONNECTED');
      expect(call.data.disconnectedAt).toBeInstanceOf(Date);
      expect(result.status).toBe('DISCONNECTED');
    });

    it('never calls delete and only updates the row', async () => {
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
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
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
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
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

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

      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);
      prisma.whatsAppIntegration.upsert.mockImplementation(({ create }: any) =>
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

      await service.connectOrUpdateForCompany('company-a', validInput, actor);
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
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
