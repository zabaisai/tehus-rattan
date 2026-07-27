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
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// WhatsAppIntegrationController only depends on WhatsAppIntegrationManagementService
// (no Prisma, no crypto service in its own constructor), so mocking that one
// service here is enough to exercise the real guards/pipe/controller without
// ever touching Prisma, WhatsAppTokenCryptoService, or Meta.
const managementServiceMock = {
  getForCompany: jest.fn(),
  connectOrUpdateForCompany: jest.fn(),
  disconnectForCompany: jest.fn(),
};

const safeIntegrationResponse = {
  id: 'integration-e2e',
  displayPhoneNumber: '+50255550000',
  phoneNumberId: 'phone-a',
  wabaId: 'waba-a',
  status: 'CONNECTED',
  connectedAt: new Date('2026-01-01T00:00:00.000Z'),
  disconnectedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('WhatsAppIntegrationController (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const signToken = (role: string, companyId: string) =>
    jwtService.sign(
      {
        sub: 'user-1',
        email: 'user@example.com',
        role,
        companyId,
        sid: encodeSid('user-1', companyId),
      },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [WhatsAppIntegrationController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
              throw new Error(`Unexpected config key requested: ${key}`);
            },
          },
        },
        { provide: PrismaService, useValue: buildFakeSessionPrisma() },
        {
          provide: WhatsAppIntegrationManagementService,
          useValue: managementServiceMock,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors src/main.ts: global prefix + global ValidationPipe, so this
    // e2e suite exercises the real production request pipeline.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    jwtService = new JwtService({ secret: TEST_JWT_SECRET });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/whatsapp-integrations/me', () => {
    it('returns 200 and the safe response for any authenticated role', async () => {
      managementServiceMock.getForCompany.mockResolvedValue(
        safeIntegrationResponse,
      );
      const token = signToken('AGENT', 'company-agent');

      const res = await request(app.getHttpServer())
        .get('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(managementServiceMock.getForCompany).toHaveBeenCalledWith(
        'company-agent',
      );
      expect(res.body.phoneNumberId).toBe('phone-a');
      expect(res.body).not.toHaveProperty('accessTokenEncrypted');
    });

    it('returns null when the service has no integration for the company', async () => {
      managementServiceMock.getForCompany.mockResolvedValue(null);
      const token = signToken('ADMIN', 'company-empty');

      const res = await request(app.getHttpServer())
        .get('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Nest sends an empty body (not the literal string "null") when a
      // handler returns `null`, so there is nothing for supertest to parse
      // into JSON — both res.text and res.body reflect that empty response.
      expect(res.text).toBe('');
      expect(res.body).toEqual({});
    });
  });

  describe('PUT /api/whatsapp-integrations/me', () => {
    const validBody = {
      phoneNumberId: 'phone-a',
      accessToken: 'fake-token',
      displayPhoneNumber: '+50255550000',
      wabaId: 'waba-a',
    };

    it('allows ADMIN, uses the companyId from the JWT, and never returns accessTokenEncrypted', async () => {
      managementServiceMock.connectOrUpdateForCompany.mockResolvedValue(
        safeIntegrationResponse,
      );
      const token = signToken('ADMIN', 'company-admin');

      const res = await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(200);

      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).toHaveBeenCalledWith('company-admin', validBody);
      expect(res.body).not.toHaveProperty('accessTokenEncrypted');
    });

    it('allows SUPER_ADMIN', async () => {
      managementServiceMock.connectOrUpdateForCompany.mockResolvedValue(
        safeIntegrationResponse,
      );
      const token = signToken('SUPER_ADMIN', 'company-super-admin');

      await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(200);

      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).toHaveBeenCalledWith('company-super-admin', validBody);
    });

    it('rejects AGENT with 403', async () => {
      const token = signToken('AGENT', 'company-agent');

      await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(403);

      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body with companyId with 400, and never forwards it to the service', async () => {
      const token = signToken('ADMIN', 'company-admin');

      const res = await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, companyId: 'company-attacker' })
        .expect(400);

      expect(res.body.message.some((m: string) => /companyId/.test(m))).toBe(
        true,
      );
      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body with status with 400', async () => {
      const token = signToken('ADMIN', 'company-admin');

      const res = await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, status: 'CONNECTED' })
        .expect(400);

      expect(res.body.message.some((m: string) => /status/.test(m))).toBe(true);
      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body with accessTokenEncrypted with 400', async () => {
      const token = signToken('ADMIN', 'company-admin');

      const res = await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, accessTokenEncrypted: 'already-encrypted' })
        .expect(400);

      expect(
        res.body.message.some((m: string) => /accessTokenEncrypted/.test(m)),
      ).toBe(true);
      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body without accessToken with 400', async () => {
      const token = signToken('ADMIN', 'company-admin');
      const { accessToken: _accessToken, ...bodyWithoutToken } = validBody;

      await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send(bodyWithoutToken)
        .expect(400);

      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body without phoneNumberId with 400', async () => {
      const token = signToken('ADMIN', 'company-admin');
      const { phoneNumberId: _phoneNumberId, ...bodyWithoutPhoneNumberId } =
        validBody;

      await request(app.getHttpServer())
        .put('/api/whatsapp-integrations/me')
        .set('Authorization', `Bearer ${token}`)
        .send(bodyWithoutPhoneNumberId)
        .expect(400);

      expect(
        managementServiceMock.connectOrUpdateForCompany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/whatsapp-integrations/me/disconnect', () => {
    it('allows ADMIN, uses the companyId from the JWT, and never returns accessTokenEncrypted', async () => {
      managementServiceMock.disconnectForCompany.mockResolvedValue({
        ...safeIntegrationResponse,
        status: 'DISCONNECTED',
      });
      const token = signToken('ADMIN', 'company-admin');

      const res = await request(app.getHttpServer())
        .post('/api/whatsapp-integrations/me/disconnect')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(managementServiceMock.disconnectForCompany).toHaveBeenCalledWith(
        'company-admin',
      );
      expect(res.body.status).toBe('DISCONNECTED');
      expect(res.body).not.toHaveProperty('accessTokenEncrypted');
    });

    it('rejects AGENT with 403', async () => {
      const token = signToken('AGENT', 'company-agent');

      await request(app.getHttpServer())
        .post('/api/whatsapp-integrations/me/disconnect')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(managementServiceMock.disconnectForCompany).not.toHaveBeenCalled();
    });
  });
});
