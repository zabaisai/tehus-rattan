import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformWhatsAppIntegrationController } from '../src/modules/whatsapp-integration/platform-whatsapp-integration.controller';
import { PlatformWhatsAppIntegrationService } from '../src/modules/whatsapp-integration/platform-whatsapp-integration.service';
import { WhatsAppIntegrationManagementService } from '../src/modules/whatsapp-integration/whatsapp-integration-management.service';
import { SupportSessionsService } from '../src/modules/platform/support-sessions.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

// Fictitious payload — never a real Meta credential.
const validBody = {
  supportSessionId: 'session-1',
  phoneNumberId: 'phone-a',
  accessToken: 'fake-meta-token',
  displayPhoneNumber: '+573001234567',
  wabaId: 'waba-a',
};

const supportSessionsMock = { validateActiveSupportSession: jest.fn() };
// Stands in for the hardened manual-connect service. Meta is therefore never
// contacted anywhere in this suite.
const managementMock = { connectOrUpdateForCompany: jest.fn() };

const safeIntegrationResponse = {
  id: 'integration-e2e',
  companyId: COMPANY_A,
  displayPhoneNumber: '+573001234567',
  phoneNumberId: 'phone-a',
  wabaId: 'waba-a',
  status: 'CONNECTED',
  connectedAt: new Date('2026-01-01T00:00:00.000Z'),
  disconnectedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function activeSessionFor(companyId: string) {
  return {
    id: 'session-1',
    actorUserId: 'user-1',
    companyId,
    reason: 'Alta de WhatsApp solicitada por el cliente',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    company: { id: companyId, name: 'Empresa QA' },
  };
}

describe('Platform support-gated WhatsApp connect (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const signToken = (role: string, companyId: string | null) =>
    jwtService.sign(
      {
        sub: 'user-1',
        email: 'platform@tehus.test',
        role,
        companyId,
        sid: encodeSid('user-1', companyId),
      },
      { expiresIn: '5m' },
    );

  const put = (companyId: string, token: string) =>
    request(app.getHttpServer())
      .put(`/api/platform/companies/${companyId}/whatsapp-integration`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [PlatformWhatsAppIntegrationController],
      providers: [
        JwtStrategy,
        // The gate itself is the REAL implementation — that is the point of
        // this suite. Only its two collaborators are mocked.
        PlatformWhatsAppIntegrationService,
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
        { provide: SupportSessionsService, useValue: supportSessionsMock },
        {
          provide: WhatsAppIntegrationManagementService,
          useValue: managementMock,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors src/main.ts: global prefix + global ValidationPipe.
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
    supportSessionsMock.validateActiveSupportSession.mockResolvedValue(
      activeSessionFor(COMPANY_A),
    );
    managementMock.connectOrUpdateForCompany.mockResolvedValue(
      safeIntegrationResponse,
    );
  });

  describe('authorization: platform SUPER_ADMIN only', () => {
    it('rejects AGENT with 403', async () => {
      await put(COMPANY_A, signToken('AGENT', COMPANY_A))
        .send(validBody)
        .expect(403);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('rejects ADMIN with 403', async () => {
      await put(COMPANY_A, signToken('ADMIN', COMPANY_A))
        .send(validBody)
        .expect(403);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('rejects a company-scoped SUPER_ADMIN with 403 (platform isolation intact)', async () => {
      // PlatformGuard admits only companyId === null. A SUPER_ADMIN that
      // belongs to a company is NOT a platform operator.
      await put(COMPANY_A, signToken('SUPER_ADMIN', COMPANY_A))
        .send(validBody)
        .expect(403);

      expect(
        supportSessionsMock.validateActiveSupportSession,
      ).not.toHaveBeenCalled();
      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .put(`/api/platform/companies/${COMPANY_A}/whatsapp-integration`)
        .send(validBody)
        .expect(401);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });
  });

  describe('support session gate', () => {
    const platformToken = () => signToken('SUPER_ADMIN', null);

    it('no support session -> 404 and nothing is written', async () => {
      supportSessionsMock.validateActiveSupportSession.mockRejectedValue(
        new NotFoundException('Sesión de soporte no encontrada'),
      );

      await put(COMPANY_A, platformToken()).send(validBody).expect(404);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('expired support session -> 403 and nothing is written', async () => {
      supportSessionsMock.validateActiveSupportSession.mockRejectedValue(
        new ForbiddenException('La sesión de soporte expiró'),
      );

      await put(COMPANY_A, platformToken()).send(validBody).expect(403);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('session for a DIFFERENT company -> 403 and nothing is written', async () => {
      supportSessionsMock.validateActiveSupportSession.mockResolvedValue(
        activeSessionFor(COMPANY_B),
      );

      await put(COMPANY_A, platformToken()).send(validBody).expect(403);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });

    it('validates the session against the JWT actor, never a client-supplied identity', async () => {
      await put(COMPANY_A, platformToken()).send(validBody).expect(200);

      expect(
        supportSessionsMock.validateActiveSupportSession,
      ).toHaveBeenCalledWith('session-1', 'user-1');
    });

    it('rejects a body without supportSessionId with 400', async () => {
      const withoutSession = {
        phoneNumberId: validBody.phoneNumberId,
        accessToken: validBody.accessToken,
        displayPhoneNumber: validBody.displayPhoneNumber,
        wabaId: validBody.wabaId,
      };

      await put(COMPANY_A, platformToken()).send(withoutSession).expect(400);

      expect(
        supportSessionsMock.validateActiveSupportSession,
      ).not.toHaveBeenCalled();
    });

    it('rejects a body carrying its own companyId with 400', async () => {
      await put(COMPANY_A, platformToken())
        .send({ ...validBody, companyId: COMPANY_B })
        .expect(400);

      expect(managementMock.connectOrUpdateForCompany).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('platform SUPER_ADMIN with a valid, matching session connects the company', async () => {
      const res = await put(COMPANY_A, signToken('SUPER_ADMIN', null))
        .send(validBody)
        .expect(200);

      expect(managementMock.connectOrUpdateForCompany).toHaveBeenCalledTimes(1);
      const [companyId, , actor, audit] =
        managementMock.connectOrUpdateForCompany.mock.calls[0];

      expect(companyId).toBe(COMPANY_A);
      expect(actor.userId).toBe('user-1');
      expect(actor.role).toBe('SUPER_ADMIN');
      expect(audit.action).toBe('WHATSAPP_MANUAL_CONNECTED_VIA_SUPPORT');
      expect(audit.metadata.supportReason).toBe(
        'Alta de WhatsApp solicitada por el cliente',
      );
      expect(res.body.status).toBe('CONNECTED');
    });

    it('never returns the token or the encrypted token in the response', async () => {
      const res = await put(COMPANY_A, signToken('SUPER_ADMIN', null))
        .send(validBody)
        .expect(200);

      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('accessTokenEncrypted');
      expect(JSON.stringify(res.body)).not.toContain('fake-meta-token');
    });

    it('never puts the token or the full phone number in the audit metadata', async () => {
      await put(COMPANY_A, signToken('SUPER_ADMIN', null))
        .send(validBody)
        .expect(200);

      const [, , , audit] =
        managementMock.connectOrUpdateForCompany.mock.calls[0];
      const serialized = JSON.stringify(audit);

      expect(serialized).not.toContain('fake-meta-token');
      expect(serialized).not.toContain('+573001234567');
      expect(audit.metadata.maskedPhoneNumber).toBe('****4567');
    });
  });
});
