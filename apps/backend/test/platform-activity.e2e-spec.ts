import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformActivityController } from '../src/modules/platform/platform-activity.controller';
import { PlatformActivityService } from '../src/modules/platform/platform-activity.service';
import {
  buildFakeSessionPrisma,
  encodeSid,
} from './helpers/fake-session-prisma';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// PlatformActivityController only depends on PlatformActivityService, so
// mocking that one service here is enough to exercise the real
// AuthGuard('jwt') + PlatformGuard + ValidationPipe pipeline without ever
// touching Prisma or a real database — same pattern as
// platform-companies.e2e-spec.ts.
const activityServiceMock = {
  getSummary: jest.fn(),
  getCompanyActivity: jest.fn(),
  listCompanySessions: jest.fn(),
  revokeSession: jest.fn(),
  revokeAllSessionsForUser: jest.fn(),
  revokeAllSessionsForCompany: jest.fn(),
};

describe('PlatformActivityController (e2e)', () => {
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [PlatformActivityController],
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
        { provide: PlatformActivityService, useValue: activityServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  describe('GET /api/platform/activity/summary', () => {
    it('allows a global SUPER_ADMIN (companyId null)', async () => {
      activityServiceMock.getSummary.mockResolvedValue({ activeSessions: 0 });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/activity/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(activityServiceMock.getSummary).toHaveBeenCalled();
    });

    it('rejects an ADMIN of a company with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/activity/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(activityServiceMock.getSummary).not.toHaveBeenCalled();
    });

    it('rejects an AGENT with 403', async () => {
      const token = signToken('AGENT', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/activity/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('rejects a request with no token at all with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/activity/summary')
        .expect(401);

      expect(activityServiceMock.getSummary).not.toHaveBeenCalled();
    });

    it('rejects an invalid/garbage token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/activity/summary')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });

  describe('cross-company isolation', () => {
    it("an ADMIN scoped to company A can never reach company B's activity — rejected the same way as any other company access, by PlatformGuard, before the id is even inspected", async () => {
      const tokenForCompanyA = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-b/activity')
        .set('Authorization', `Bearer ${tokenForCompanyA}`)
        .expect(403);

      expect(activityServiceMock.getCompanyActivity).not.toHaveBeenCalled();
    });

    it('a company-scoped SUPER_ADMIN (if one existed) is rejected the same way — only companyId === null passes', async () => {
      const scopedSuperAdminToken = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-b/sessions')
        .set('Authorization', `Bearer ${scopedSuperAdminToken}`)
        .expect(403);
    });

    it('a global SUPER_ADMIN can reach any companyId in the path', async () => {
      activityServiceMock.getCompanyActivity.mockResolvedValue({
        hasHistoricalData: false,
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-b/activity')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(activityServiceMock.getCompanyActivity).toHaveBeenCalledWith(
        'company-b',
      );
    });
  });

  describe('revoke endpoints all require a global SUPER_ADMIN', () => {
    it('POST /api/platform/sessions/:id/revoke rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/sessions/session-1/revoke')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(activityServiceMock.revokeSession).not.toHaveBeenCalled();
    });

    it('POST /api/platform/sessions/:id/revoke succeeds for a global SUPER_ADMIN', async () => {
      activityServiceMock.revokeSession.mockResolvedValue({
        id: 'session-1',
        status: 'REVOKED',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/sessions/session-1/revoke')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(activityServiceMock.revokeSession).toHaveBeenCalled();
    });

    it('POST /api/platform/users/:id/sessions/revoke-all rejects unauthenticated with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/platform/users/user-1/sessions/revoke-all')
        .expect(401);
    });

    it('POST /api/platform/companies/:id/sessions/revoke-all rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/companies/company-a/sessions/revoke-all')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(
        activityServiceMock.revokeAllSessionsForCompany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('responses never carry tokens or hashes', () => {
    it('the sessions list response never contains a refreshTokenHash-shaped field', async () => {
      activityServiceMock.listCompanySessions.mockResolvedValue({
        items: [
          {
            id: 'session-1',
            userId: 'user-1',
            status: 'ACTIVE',
            ipPreview: '181.***.***.24',
            browser: 'Chrome 120',
            operatingSystem: 'Windows 10',
            deviceType: 'DESKTOP',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/companies/company-a/sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/refreshTokenHash/i);
      expect(body).not.toMatch(/"ipAddress"/);
      expect(body).toContain('181.***.***.24');
    });
  });
});
