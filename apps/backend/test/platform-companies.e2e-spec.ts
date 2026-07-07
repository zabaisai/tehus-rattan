import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PlatformCompaniesController } from '../src/modules/platform/platform-companies.controller';
import { PlatformCompaniesService } from '../src/modules/platform/platform-companies.service';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// PlatformCompaniesController only depends on PlatformCompaniesService,
// so mocking that one service here is enough to exercise the real
// AuthGuard('jwt') + PlatformGuard + ValidationPipe pipeline without ever
// touching Prisma or a real database.
const companiesServiceMock = {
  listCompanies: jest.fn(),
  getCompanyDetail: jest.fn(),
  createCompany: jest.fn(),
  updateCompanyStatus: jest.fn(),
  getSupportOverview: jest.fn(),
};

describe('PlatformCompaniesController (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const signToken = (role: string, companyId: string | null) =>
    jwtService.sign(
      { sub: 'user-1', email: 'platform@tehus.test', role, companyId },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [PlatformCompaniesController],
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
        {
          provide: PlatformCompaniesService,
          useValue: companiesServiceMock,
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

  describe('GET /api/platform/companies', () => {
    it('allows a global SUPER_ADMIN (companyId null)', async () => {
      companiesServiceMock.listCompanies.mockResolvedValue([]);
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(companiesServiceMock.listCompanies).toHaveBeenCalled();
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(companiesServiceMock.listCompanies).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(companiesServiceMock.listCompanies).not.toHaveBeenCalled();
    });

    it('rejects a request without a token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/companies')
        .expect(401);

      expect(companiesServiceMock.listCompanies).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/platform/companies/:id', () => {
    it('allows a global SUPER_ADMIN', async () => {
      companiesServiceMock.getCompanyDetail.mockResolvedValue({
        id: 'company-a',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-a')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(companiesServiceMock.getCompanyDetail).toHaveBeenCalledWith(
        'company-a',
      );
    });

    it('rejects AGENT with 403', async () => {
      const token = signToken('AGENT', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-a')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('POST /api/platform/companies', () => {
    const validBody = {
      companyName: 'New Co',
      adminName: 'New Admin',
      adminEmail: 'new-admin@company.test',
      adminPassword: 'plain-password',
    };

    it('allows a global SUPER_ADMIN and returns 201', async () => {
      companiesServiceMock.createCompany.mockResolvedValue({
        id: 'company-new',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(201);

      expect(companiesServiceMock.createCompany).toHaveBeenCalledWith(
        validBody,
        expect.objectContaining({
          actorUserId: 'user-1',
          actorRole: 'SUPER_ADMIN',
        }),
      );
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .post('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody)
        .expect(403);

      expect(companiesServiceMock.createCompany).not.toHaveBeenCalled();
    });

    it('rejects an invalid adminEmail with 400', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, adminEmail: 'not-an-email' })
        .expect(400);

      expect(companiesServiceMock.createCompany).not.toHaveBeenCalled();
    });

    it('rejects a short adminPassword with 400', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, adminPassword: '123' })
        .expect(400);

      expect(companiesServiceMock.createCompany).not.toHaveBeenCalled();
    });

    it('rejects a body with companyId with 400, and never forwards it to the service', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, companyId: 'company-attacker' })
        .expect(400);

      expect(companiesServiceMock.createCompany).not.toHaveBeenCalled();
    });

    it('rejects a body with role with 400, so SUPER_ADMIN can never be created here', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .post('/api/platform/companies')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validBody, role: 'SUPER_ADMIN' })
        .expect(400);

      expect(companiesServiceMock.createCompany).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/platform/companies/:id/status', () => {
    it('allows a global SUPER_ADMIN', async () => {
      companiesServiceMock.updateCompanyStatus.mockResolvedValue({
        id: 'company-a',
        status: 'SUSPENDED',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .patch('/api/platform/companies/company-a/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      expect(companiesServiceMock.updateCompanyStatus).toHaveBeenCalledWith(
        'company-a',
        'SUSPENDED',
        expect.objectContaining({
          actorUserId: 'user-1',
          actorRole: 'SUPER_ADMIN',
        }),
        undefined,
      );
    });

    it('forwards an optional reason to the service', async () => {
      companiesServiceMock.updateCompanyStatus.mockResolvedValue({
        id: 'company-a',
        status: 'SUSPENDED',
      });
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .patch('/api/platform/companies/company-a/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED', reason: 'Falta de pago reportada' })
        .expect(200);

      expect(companiesServiceMock.updateCompanyStatus).toHaveBeenCalledWith(
        'company-a',
        'SUSPENDED',
        expect.any(Object),
        'Falta de pago reportada',
      );
    });

    it('rejects a reason longer than 500 characters with 400', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .patch('/api/platform/companies/company-a/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED', reason: 'a'.repeat(501) })
        .expect(400);

      expect(
        companiesServiceMock.updateCompanyStatus,
      ).not.toHaveBeenCalled();
    });

    it('rejects an invalid status value with 400', async () => {
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .patch('/api/platform/companies/company-a/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'NOT_A_STATUS' })
        .expect(400);

      expect(
        companiesServiceMock.updateCompanyStatus,
      ).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .patch('/api/platform/companies/company-a/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' })
        .expect(403);

      expect(
        companiesServiceMock.updateCompanyStatus,
      ).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/platform/companies/:id/support-overview', () => {
    const safeOverview = {
      company: { id: 'company-a', name: 'Company A' },
      users: { total: 1, active: 1, items: [] },
      counts: { contacts: 0, leads: 0, conversations: 0, tasks: 0, products: 0 },
      whatsapp: {
        connected: false,
        status: null,
        phoneNumberId: null,
        displayPhoneNumber: null,
      },
      recentLeads: [],
      recentConversations: [],
      recentTasks: [],
      lastActivityAt: null,
    };

    it('allows a global SUPER_ADMIN and returns a safe overview', async () => {
      companiesServiceMock.getSupportOverview.mockResolvedValue(safeOverview);
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/companies/company-a/support-overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(companiesServiceMock.getSupportOverview).toHaveBeenCalledWith(
        'company-a',
        expect.objectContaining({
          actorUserId: 'user-1',
          actorRole: 'SUPER_ADMIN',
        }),
      );
      expect(res.body).not.toHaveProperty('accessTokenEncrypted');
      expect(JSON.stringify(res.body)).not.toContain('messages');
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-a/support-overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(companiesServiceMock.getSupportOverview).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/companies/company-a/support-overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(companiesServiceMock.getSupportOverview).not.toHaveBeenCalled();
    });

    it('rejects a request without a token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/companies/company-a/support-overview')
        .expect(401);

      expect(companiesServiceMock.getSupportOverview).not.toHaveBeenCalled();
    });
  });
});
