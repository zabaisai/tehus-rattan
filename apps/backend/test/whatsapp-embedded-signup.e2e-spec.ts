import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { WhatsAppIntegrationController } from '../src/modules/whatsapp-integration/whatsapp-integration.controller';
import { WhatsAppIntegrationManagementService } from '../src/modules/whatsapp-integration/whatsapp-integration-management.service';
import { WhatsAppIntegrationService } from '../src/modules/whatsapp-integration/whatsapp-integration.service';
import { WhatsAppEmbeddedSignupService } from '../src/modules/whatsapp-integration/whatsapp-embedded-signup.service';
import { WhatsAppEmbeddedSignupStateService } from '../src/modules/whatsapp-integration/whatsapp-embedded-signup-state.service';
import { WhatsAppTokenCryptoService } from '../src/modules/whatsapp-integration/whatsapp-token-crypto.service';
import { WhatsAppMetaClientService } from '../src/modules/whatsapp-integration/whatsapp-meta-client.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// Minimal in-memory Prisma for the two models the flow touches. Enough to
// exercise single-use state, cross-company uniqueness and status persistence
// through the real HTTP pipeline — no real DB, no real Meta.
function buildFakePrisma() {
  const states: any[] = [];
  const integrations: any[] = [];
  const gt = (a: Date, b: any) => a.getTime() > new Date(b).getTime();

  const client: any = {
    ...buildFakeSessionPrisma(),
    whatsAppEmbeddedSignupState: {
      deleteMany: async ({ where }: any) => {
        for (let i = states.length - 1; i >= 0; i--) {
          if (
            states[i].companyId === where.companyId &&
            (where.usedAt === null ? states[i].usedAt === null : true)
          )
            states.splice(i, 1);
        }
        return { count: 0 };
      },
      create: async ({ data }: any) => {
        states.push({ usedAt: null, ...data });
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const s of states) {
          if (
            s.stateHash === where.stateHash &&
            s.companyId === where.companyId &&
            s.usedAt === null &&
            gt(s.expiresAt, where.expiresAt.gt)
          ) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      },
      findFirst: async ({ where }: any) =>
        states.find(
          (s) =>
            s.companyId === where.companyId &&
            s.usedAt === null &&
            gt(s.expiresAt, where.expiresAt.gt),
        ) ?? null,
    },
    whatsAppIntegration: {
      findUnique: async ({ where }: any) =>
        integrations.find(
          (i) =>
            (where.companyId && i.companyId === where.companyId) ||
            (where.phoneNumberId && i.phoneNumberId === where.phoneNumberId),
        ) ?? null,
      findFirst: async ({ where }: any) =>
        integrations.find(
          (i) =>
            i.companyId === where.companyId &&
            (!where.status || i.status === where.status),
        ) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = integrations.find(
          (i) => i.companyId === where.companyId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `wai-${integrations.length + 1}`, ...create };
        integrations.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const i of integrations) {
          if (i.companyId === where.companyId) {
            Object.assign(i, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (cb: any) => cb(client),
    auditLog: { create: async () => ({}) },
  };
  return { client, states, integrations };
}

describe('WhatsApp Embedded Signup (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let store: ReturnType<typeof buildFakePrisma>;
  let metaMock: any;

  const token = (role: string, companyId: string) =>
    jwt.sign(
      {
        sub: `user-${companyId}`,
        email: 'u@e2e.local',
        role,
        companyId,
        sid: encodeSid(`user-${companyId}`, companyId),
      },
      { expiresIn: '5m' },
    );

  // A fictitious WABA / phone — never a real number.
  const PHONE = '100000000000001';
  const WABA = '200000000000002';

  beforeAll(async () => {
    store = buildFakePrisma();
    metaMock = {
      appId: () => 'app-id',
      configId: () => 'config-id',
      graphVersion: () => 'v25.0',
      exchangeCode: jest.fn().mockResolvedValue('SECRET-TOKEN'),
      listPhoneNumbers: jest.fn().mockResolvedValue([
        {
          id: PHONE,
          displayPhoneNumber: '+57 300 555 4521',
          verifiedName: 'Tehus QA',
          platformType: 'CLOUD_API',
        },
      ]),
      subscribeAppToWaba: jest.fn().mockResolvedValue(undefined),
      sendText: jest.fn().mockResolvedValue(undefined),
    };

    const config = {
      get: (k: string) =>
        ({
          WHATSAPP_EMBEDDED_SIGNUP_ENABLED: 'true',
          WHATSAPP_TOKEN_ENCRYPTION_KEY: 'e2e-encryption-key',
        })[k],
      getOrThrow: (k: string) => {
        if (k === 'JWT_SECRET') return TEST_JWT_SECRET;
        throw new Error(`Unexpected key ${k}`);
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [WhatsAppIntegrationController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: store.client },
        { provide: WhatsAppMetaClientService, useValue: metaMock },
        {
          provide: NotificationsService,
          useValue: {
            emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PlatformAuditLogService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WhatsAppIntegrationManagementService,
          useValue: {
            getForCompany: jest.fn(),
            disconnectForCompany: jest
              .fn()
              .mockResolvedValue({ status: 'DISCONNECTED' }),
            connectOrUpdateForCompany: jest.fn(),
          },
        },
        WhatsAppIntegrationService,
        WhatsAppTokenCryptoService,
        WhatsAppEmbeddedSignupStateService,
        WhatsAppEmbeddedSignupService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwt = new JwtService({ secret: TEST_JWT_SECRET });
  });

  afterAll(async () => app?.close());

  const start = (role: string, company: string) =>
    request(app.getHttpServer())
      .post('/api/whatsapp-integrations/me/embedded-signup/start')
      .set('Authorization', `Bearer ${token(role, company)}`);

  const complete = (role: string, company: string, body: any) =>
    request(app.getHttpServer())
      .post('/api/whatsapp-integrations/me/embedded-signup/complete')
      .set('Authorization', `Bearer ${token(role, company)}`)
      .send(body);

  it('rejects AGENT from starting the flow (403)', async () => {
    await start('AGENT', 'company-a').expect(403);
  });

  it('lets ADMIN start and returns public config + state but never a secret', async () => {
    const res = await start('ADMIN', 'company-a').expect(200);
    expect(res.body.appId).toBe('app-id');
    expect(res.body.configId).toBe('config-id');
    expect(res.body.state).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toContain('e2e-encryption-key');
  });

  it('rejects a malformed complete DTO / non-whitelisted fields (400)', async () => {
    const res = await start('ADMIN', 'company-a').expect(200);
    await complete('ADMIN', 'company-a', {
      state: res.body.state,
      code: 'c',
      phoneNumberId: PHONE,
      wabaId: WABA,
      accessToken: 'attacker-supplied', // non-whitelisted
    }).expect(400);
    await complete('ADMIN', 'company-a', {
      state: 'short',
      code: 'c',
      phoneNumberId: PHONE,
      wabaId: WABA,
    }).expect(400);
  });

  it('completes the flow, persists CONNECTED and never returns a token', async () => {
    const res = await start('ADMIN', 'company-a').expect(200);
    const done = await complete('ADMIN', 'company-a', {
      state: res.body.state,
      code: 'valid-code',
      phoneNumberId: PHONE,
      wabaId: WABA,
    }).expect(200);
    expect(done.body.status).toBe('CONNECTED');
    expect(done.body.maskedPhoneNumber).toMatch(/4521$/);
    const serialized = JSON.stringify(done.body);
    expect(serialized).not.toContain('SECRET-TOKEN');
    expect(serialized).not.toMatch(/accessToken/i);
    // The token was stored encrypted, not in plaintext.
    const stored = store.integrations.find((i) => i.companyId === 'company-a');
    expect(stored.accessTokenEncrypted).toContain(':');
    expect(stored.accessTokenEncrypted).not.toContain('SECRET-TOKEN');
  });

  it('enforces single-use state (a consumed state cannot be replayed)', async () => {
    const res = await start('ADMIN', 'company-c').expect(200);
    const body = {
      state: res.body.state,
      code: 'c1',
      phoneNumberId: '100000000000009',
      wabaId: WABA,
    };
    metaMock.listPhoneNumbers.mockResolvedValueOnce([
      { id: '100000000000009', displayPhoneNumber: '+57 300 000 0000' },
    ]);
    await complete('ADMIN', 'company-c', body).expect(200);
    // Replaying the same state → generic 400.
    await complete('ADMIN', 'company-c', body).expect(400);
  });

  it('binds the state to the company (company-b cannot use company-a state)', async () => {
    const res = await start('ADMIN', 'company-a').expect(200);
    await complete('ADMIN', 'company-b', {
      state: res.body.state,
      code: 'c',
      phoneNumberId: '100000000000077',
      wabaId: WABA,
    }).expect(400);
  });

  it('prevents connecting a phoneNumberId already owned by another company (409)', async () => {
    // company-a already owns PHONE (connected above). company-b attempts it.
    const res = await start('ADMIN', 'company-b').expect(200);
    await complete('ADMIN', 'company-b', {
      state: res.body.state,
      code: 'c',
      phoneNumberId: PHONE,
      wabaId: WABA,
    }).expect(409);
  });

  it('connection-status is ADMIN/SUPER_ADMIN only and never leaks a token', async () => {
    await request(app.getHttpServer())
      .get('/api/whatsapp-integrations/me/connection-status')
      .set('Authorization', `Bearer ${token('AGENT', 'company-a')}`)
      .expect(403);
    const res = await request(app.getHttpServer())
      .get('/api/whatsapp-integrations/me/connection-status')
      .set('Authorization', `Bearer ${token('ADMIN', 'company-a')}`)
      .expect(200);
    expect(res.body.status).toBe('CONNECTED');
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    // Enriched, non-secret fields present.
    expect(res.body).toHaveProperty('webhookStatus');
    expect(res.body).toHaveProperty('actionRequired');
    expect(res.body).toHaveProperty('coexistence');
  });

  it('POST /me/test validates E.164 and sends via the connected integration', async () => {
    // Bad format → 400 (DTO validation), no send.
    await request(app.getHttpServer())
      .post('/api/whatsapp-integrations/me/test')
      .set('Authorization', `Bearer ${token('ADMIN', 'company-a')}`)
      .send({ to: '3001234567' })
      .expect(400);
    // Valid E.164 → 200; a text is sent through the Meta client.
    const before = metaMock.sendText.mock.calls.length;
    const res = await request(app.getHttpServer())
      .post('/api/whatsapp-integrations/me/test')
      .set('Authorization', `Bearer ${token('ADMIN', 'company-a')}`)
      .send({ to: '+573001234567' })
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(metaMock.sendText.mock.calls.length).toBe(before + 1);
  });

  it('POST /me/test is rejected for AGENT (403)', async () => {
    await request(app.getHttpServer())
      .post('/api/whatsapp-integrations/me/test')
      .set('Authorization', `Bearer ${token('AGENT', 'company-a')}`)
      .send({ to: '+573001234567' })
      .expect(403);
  });

  it('POST /me/disconnect is local-only (ADMIN allowed, returns DISCONNECTED)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/whatsapp-integrations/me/disconnect')
      .set('Authorization', `Bearer ${token('ADMIN', 'company-a')}`)
      .expect(201);
    expect(res.body.status).toBe('DISCONNECTED');
  });
});
