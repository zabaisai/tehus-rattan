import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';
import { MetaSignupError } from './whatsapp-meta-client.service';
import { EmbeddedSignupCompleteDto } from './dto/embedded-signup-complete.dto';

const actor = {
  userId: 'user-1',
  role: 'ADMIN' as const,
  ipPreview: '203.0.113.0/24',
  userAgent: 'jest',
};

// A completely fictitious WABA / phone / business — never a real number.
const dto: EmbeddedSignupCompleteDto = {
  state: 'a'.repeat(64),
  code: 'fake-exchange-code',
  phoneNumberId: '100000000000001',
  wabaId: '200000000000002',
  businessId: '300000000000003',
};

function build(overrides: any = {}) {
  const savedIntegration = {
    id: 'wai-1',
    status: 'CONNECTED',
    connectionMethod: 'EMBEDDED_SIGNUP',
    displayPhoneNumber: '+57 300 555 4521',
    businessName: 'Tehus QA',
    connectedAt: new Date('2026-07-27T00:00:00Z'),
    lastCheckedAt: new Date('2026-07-27T00:00:00Z'),
    ...overrides.saved,
  };
  const tx = {
    whatsAppIntegration: {
      upsert: jest.fn().mockResolvedValue(savedIntegration),
    },
  };
  const prisma = {
    whatsAppIntegration: {
      // findUnique sigue siendo correcto para el guard cross-tenant: se
      // consulta por phoneNumberId, que sigue siendo UNICO global.
      findUnique: jest.fn().mockResolvedValue(null),
      // findFirst resuelve la integracion PRINCIPAL de la empresa (1:N).
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as any;
  const config = {
    get: jest.fn((key: string) =>
      key === 'WHATSAPP_EMBEDDED_SIGNUP_ENABLED' ? 'true' : undefined,
    ),
  } as any;
  const stateService = {
    issueForCompany: jest.fn().mockResolvedValue({
      state: 'plain-state',
      expiresAt: new Date(Date.now() + 600000),
    }),
    consumeForCompany: jest.fn().mockResolvedValue(undefined),
    hasActiveState: jest.fn().mockResolvedValue(false),
  } as any;
  const metaClient = {
    appId: jest.fn().mockReturnValue('app-id'),
    configId: jest.fn().mockReturnValue('config-id'),
    graphVersion: jest.fn().mockReturnValue('v25.0'),
    exchangeCode: jest.fn().mockResolvedValue('SECRET-BUSINESS-TOKEN'),
    listPhoneNumbers: jest.fn().mockResolvedValue([
      {
        id: dto.phoneNumberId,
        displayPhoneNumber: '+57 300 555 4521',
        verifiedName: 'Tehus QA',
        platformType: 'CLOUD_API',
      },
    ]),
    subscribeAppToWaba: jest.fn().mockResolvedValue(undefined),
    ...overrides.metaClient,
  };
  const tokenCrypto = {
    encrypt: jest.fn().mockReturnValue('iv:tag:cipher'),
    decrypt: jest.fn().mockReturnValue('SECRET-BUSINESS-TOKEN'),
  } as any;
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const integrationService = {
    findConnectedByCompanyId: jest.fn().mockResolvedValue({
      phoneNumberId: '100000000000001',
      accessTokenEncrypted: 'iv:tag:cipher',
    }),
    ...overrides.integrationService,
  } as any;
  const management = {
    disconnectForCompany: jest
      .fn()
      .mockResolvedValue({ status: 'DISCONNECTED' }),
  } as any;
  const notifications = {
    emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
  } as any;
  metaClient.sendText =
    metaClient.sendText ?? jest.fn().mockResolvedValue(undefined);

  const service = new WhatsAppEmbeddedSignupService(
    prisma,
    config,
    stateService,
    metaClient,
    tokenCrypto,
    auditLog,
    integrationService,
    management,
    notifications,
  );
  return {
    service,
    prisma,
    tx,
    config,
    stateService,
    metaClient,
    tokenCrypto,
    auditLog,
    integrationService,
    management,
    notifications,
    savedIntegration,
  };
}

describe('WhatsAppEmbeddedSignupService', () => {
  describe('start', () => {
    it('returns public config + a single-use state and audits the start', async () => {
      const { service, stateService, auditLog } = build();
      const res = await service.start('company-a', actor);
      expect(res).toMatchObject({
        appId: 'app-id',
        configId: 'config-id',
        graphVersion: 'v25.0',
        state: 'plain-state',
      });
      expect(stateService.issueForCompany).toHaveBeenCalledWith(
        'company-a',
        'user-1',
        '203.0.113.0/24',
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'WHATSAPP_SIGNUP_STARTED' }),
      );
    });

    it('is a controlled 503 when the feature is disabled', async () => {
      const { service, config } = build();
      config.get.mockReturnValue(undefined);
      await expect(service.start('company-a', actor)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('complete', () => {
    it('runs the full happy path: consume state, exchange code, verify WABA, subscribe, encrypt, persist CONNECTED', async () => {
      const { service, stateService, metaClient, tokenCrypto, tx } = build();
      const res = await service.complete('company-a', actor, dto);

      expect(stateService.consumeForCompany).toHaveBeenCalledWith(
        'company-a',
        dto.state,
      );
      expect(metaClient.exchangeCode).toHaveBeenCalledWith(dto.code);
      expect(metaClient.listPhoneNumbers).toHaveBeenCalledWith(
        dto.wabaId,
        'SECRET-BUSINESS-TOKEN',
      );
      expect(metaClient.subscribeAppToWaba).toHaveBeenCalledWith(
        dto.wabaId,
        'SECRET-BUSINESS-TOKEN',
      );
      // Token is encrypted before persistence.
      expect(tokenCrypto.encrypt).toHaveBeenCalledWith('SECRET-BUSINESS-TOKEN');
      const upsertData = tx.whatsAppIntegration.upsert.mock.calls[0][0];
      expect(upsertData.create.accessTokenEncrypted).toBe('iv:tag:cipher');
      expect(upsertData.create.status).toBe('CONNECTED');
      expect(upsertData.create.connectionMethod).toBe('EMBEDDED_SIGNUP');
      expect(res.status).toBe('CONNECTED');
    });

    it('never returns the token (plaintext or encrypted) to the caller', async () => {
      const { service } = build();
      const res: any = await service.complete('company-a', actor, dto);
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain('SECRET-BUSINESS-TOKEN');
      expect(serialized).not.toContain('iv:tag:cipher');
      expect(res).not.toHaveProperty('accessToken');
      expect(res).not.toHaveProperty('accessTokenEncrypted');
      // The phone is masked.
      expect(res.maskedPhoneNumber).toMatch(/4521$/);
      expect(res.maskedPhoneNumber).not.toContain('300');
    });

    it('detects Coexistence from the phone platform type and never registers the number', async () => {
      const { service, metaClient, tx } = build({
        metaClient: {
          listPhoneNumbers: jest.fn().mockResolvedValue([
            {
              id: dto.phoneNumberId,
              displayPhoneNumber: '+57 300 555 4521',
              platformType: 'COEXISTENCE',
            },
          ]),
        },
      });
      await service.complete('company-a', actor, dto);
      expect(
        tx.whatsAppIntegration.upsert.mock.calls[0][0].create.connectionMethod,
      ).toBe('COEXISTENCE');
      // The Meta client never exposes a register call in this flow.
      expect(metaClient.registerPhoneNumber).toBeUndefined();
    });

    it('rejects with a generic error when the code exchange fails (no Meta detail leaked)', async () => {
      const { service, prisma, auditLog } = build({
        metaClient: {
          exchangeCode: jest
            .fn()
            .mockRejectedValue(new MetaSignupError('CODE_EXCHANGE_FAILED')),
        },
      });
      await expect(
        service.complete('company-a', actor, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.complete('company-a', actor, dto),
      ).rejects.not.toThrow(/CODE_EXCHANGE/);
      // Failure is recorded (ERROR + audit) with only a classifier.
      expect(prisma.whatsAppIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ERROR' }),
        }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'WHATSAPP_SIGNUP_FAILED' }),
      );
    });

    it('rejects when the phoneNumberId is not part of the authorized WABA', async () => {
      const { service } = build({
        metaClient: {
          listPhoneNumbers: jest
            .fn()
            .mockResolvedValue([{ id: '999', displayPhoneNumber: 'x' }]),
        },
      });
      await expect(
        service.complete('company-a', actor, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with 409 when the phoneNumberId already belongs to another company', async () => {
      const { service, prisma } = build();
      // El guard cross-tenant consulta por phoneNumberId (unico global), asi
      // que sigue siendo findUnique. Es justamente lo que impide que un numero
      // se conecte a dos empresas aunque una empresa pueda tener varios.
      prisma.whatsAppIntegration.findUnique.mockResolvedValue({
        companyId: 'company-b',
      });
      await expect(
        service.complete('company-a', actor, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a Meta timeout to a generic client error', async () => {
      const { service } = build({
        metaClient: {
          exchangeCode: jest
            .fn()
            .mockRejectedValue(new MetaSignupError('META_TIMEOUT')),
        },
      });
      await expect(
        service.complete('company-a', actor, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the companyId argument (from the JWT) — cross-tenant isolation', async () => {
      const { service, stateService } = build();
      await service.complete('company-victim', actor, dto);
      expect(stateService.consumeForCompany).toHaveBeenCalledWith(
        'company-victim',
        dto.state,
      );
    });
  });

  describe('reconnect', () => {
    it('issues a new state WITHOUT degrading the current integration (cancel-safe) and audits', async () => {
      const { service, prisma, auditLog } = build();
      const res = await service.reconnect('company-a', actor);
      expect(res.state).toBe('plain-state');
      // The existing integration must NOT be flipped to REAUTH_REQUIRED on
      // start — otherwise cancelling the popup would leave it degraded.
      expect(prisma.whatsAppIntegration.updateMany).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'WHATSAPP_RECONNECTED' }),
      );
    });
  });

  describe('disconnectLocal', () => {
    it('disconnects locally and audits WHATSAPP_DISCONNECTED_LOCAL (no Meta call)', async () => {
      const { service, management, auditLog } = build();
      await service.disconnectLocal('company-a', actor);
      expect(management.disconnectForCompany).toHaveBeenCalledWith('company-a');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'WHATSAPP_DISCONNECTED_LOCAL' }),
      );
    });
  });

  describe('sendTest', () => {
    it('sends one text via the connected integration and audits the test', async () => {
      const { service, metaClient, tokenCrypto, auditLog } = build();
      const res = await service.sendTest('company-a', actor, '+573001234567');
      expect(res).toEqual({ status: 'ok' });
      expect(tokenCrypto.decrypt).toHaveBeenCalledWith('iv:tag:cipher');
      expect(metaClient.sendText).toHaveBeenCalledWith(
        '100000000000001',
        'SECRET-BUSINESS-TOKEN',
        '+573001234567',
        expect.any(String),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'WHATSAPP_CONNECTION_TESTED' }),
      );
    });

    it('rejects when the company is not connected', async () => {
      const { service } = build({
        integrationService: {
          findConnectedByCompanyId: jest.fn().mockResolvedValue(null),
        },
      });
      await expect(
        service.sendTest('company-a', actor, '+573001234567'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps a Meta send failure to a generic error and still audits', async () => {
      const { service, auditLog } = build({
        metaClient: {
          sendText: jest
            .fn()
            .mockRejectedValue(new MetaSignupError('SEND_FAILED')),
        },
      });
      await expect(
        service.sendTest('company-a', actor, '+573001234567'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'WHATSAPP_CONNECTION_TESTED',
          reason: 'failed',
        }),
      );
    });
  });

  describe('getConnectionStatus', () => {
    it('returns a masked, token-free snapshot when connected', async () => {
      const { service, prisma } = build();
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
        status: 'CONNECTED',
        connectionMethod: 'EMBEDDED_SIGNUP',
        displayPhoneNumber: '+57 300 555 4521',
        businessName: 'Tehus QA',
        connectedAt: new Date(),
        lastCheckedAt: new Date(),
        accessTokenEncrypted: 'iv:tag:cipher',
      });
      const res: any = await service.getConnectionStatus('company-a');
      expect(res.status).toBe('CONNECTED');
      expect(res).not.toHaveProperty('accessTokenEncrypted');
      expect(res.maskedPhoneNumber).toMatch(/4521$/);
      // Enriched, non-secret fields.
      expect(res.coexistence).toBe(false);
      expect(res.webhookStatus).toBe('SUBSCRIBED');
      expect(res.actionRequired).toBe(false);
      expect(res).toHaveProperty('errorCode', null);
    });

    it('flags actionRequired + errorCode when the integration is in ERROR', async () => {
      const { service, prisma } = build();
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
        status: 'ERROR',
        connectionMethod: 'COEXISTENCE',
        displayPhoneNumber: '+57 300 555 4521',
        businessName: 'Tehus QA',
        connectedAt: new Date(),
        lastCheckedAt: new Date(),
        lastErrorCode: 'CODE_EXCHANGE_FAILED',
      });
      const res: any = await service.getConnectionStatus('company-a');
      expect(res.actionRequired).toBe(true);
      expect(res.errorCode).toBe('CODE_EXCHANGE_FAILED');
      expect(res.coexistence).toBe(true);
      expect(res.webhookStatus).toBe('UNKNOWN');
    });

    it('is CONNECTING when no integration exists yet but a state is active', async () => {
      const { service, prisma, stateService } = build();
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);
      stateService.hasActiveState.mockResolvedValue(true);
      expect((await service.getConnectionStatus('company-a')).status).toBe(
        'CONNECTING',
      );
    });

    it('is NOT_CONNECTED when there is no integration and no active state', async () => {
      const { service, prisma, stateService } = build();
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);
      stateService.hasActiveState.mockResolvedValue(false);
      expect((await service.getConnectionStatus('company-a')).status).toBe(
        'NOT_CONNECTED',
      );
    });
  });
});
