import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { AutomationsController } from '../src/modules/automations/automations.controller';
import { AutomationsService } from '../src/modules/automations/automations.service';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// Regression coverage for the bug found during the integral QA pass: both
// controllers declare @Roles('ADMIN', 'SUPER_ADMIN') at the *class* level
// only (no per-method decorator), which the old RolesGuard silently ignored
// because it only ever read metadata off context.getHandler(). An AGENT
// could therefore call every route on both controllers. Both services are
// mocked so this test exercises auth/roles only, never real data.
const analyticsServiceMock = {
  getOverview: jest.fn(),
};

const automationsServiceMock = {
  findAll: jest.fn(),
};

describe('RolesGuard (e2e) — class-level @Roles enforcement', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const signToken = (role: string, companyId: string | null) =>
    jwtService.sign(
      { sub: 'user-1', email: 'user@example.com', role, companyId },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [AnalyticsController, AutomationsController],
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
        { provide: AnalyticsService, useValue: analyticsServiceMock },
        { provide: AutomationsService, useValue: automationsServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    jwtService = new JwtService({ secret: TEST_JWT_SECRET });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/analytics/overview', () => {
    it('rejects AGENT with 403 (class-level @Roles must still apply)', async () => {
      const token = signToken('AGENT', 'company-a');

      await request(app.getHttpServer())
        .get('/api/analytics/overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(analyticsServiceMock.getOverview).not.toHaveBeenCalled();
    });

    it('allows ADMIN through RolesGuard', async () => {
      analyticsServiceMock.getOverview.mockResolvedValue({ ok: true });
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/analytics/overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(analyticsServiceMock.getOverview).toHaveBeenCalledWith('company-a');
    });

    it('rejects a request without a JWT with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/analytics/overview')
        .expect(401);

      expect(analyticsServiceMock.getOverview).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/automations', () => {
    it('rejects AGENT with 403 (class-level @Roles must still apply)', async () => {
      const token = signToken('AGENT', 'company-a');

      await request(app.getHttpServer())
        .get('/api/automations')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(automationsServiceMock.findAll).not.toHaveBeenCalled();
    });

    it('allows ADMIN through RolesGuard', async () => {
      automationsServiceMock.findAll.mockResolvedValue([]);
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/automations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(automationsServiceMock.findAll).toHaveBeenCalledWith('company-a');
    });

    it('rejects a request without a JWT with 401', async () => {
      await request(app.getHttpServer()).get('/api/automations').expect(401);

      expect(automationsServiceMock.findAll).not.toHaveBeenCalled();
    });
  });
});
