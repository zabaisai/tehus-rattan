import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { PlatformAuditLogController } from '../src/modules/platform/platform-audit-log.controller';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// PlatformAuditLogController only depends on PlatformAuditLogService, so
// mocking that one service here is enough to exercise the real
// AuthGuard('jwt') + PlatformGuard + ValidationPipe pipeline without ever
// touching Prisma or a real database.
const auditLogServiceMock = {
  list: jest.fn(),
};

const safeLogEntry = {
  id: 'audit-1',
  actorUserId: 'super-admin-1',
  actorRole: 'SUPER_ADMIN',
  actor: {
    id: 'super-admin-1',
    name: 'Platform Admin',
    email: 'admin.platform@tehus.test',
  },
  affectedCompanyId: 'company-a',
  affectedCompany: { id: 'company-a', name: 'Company A' },
  action: 'CREATE_COMPANY',
  entityType: 'Company',
  entityId: 'company-a',
  reason: null,
  metadata: { companyName: 'Company A' },
  ipAddress: '127.0.0.1',
  userAgent: 'jest-test-agent',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('PlatformAuditLogController (e2e)', () => {
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
      controllers: [PlatformAuditLogController],
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
          provide: PlatformAuditLogService,
          useValue: auditLogServiceMock,
        },
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

  describe('GET /api/platform/audit-logs', () => {
    it('allows a global SUPER_ADMIN and returns safe log entries', async () => {
      auditLogServiceMock.list.mockResolvedValue([safeLogEntry]);
      const token = signToken('SUPER_ADMIN', null);

      const res = await request(app.getHttpServer())
        .get('/api/platform/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(auditLogServiceMock.list).toHaveBeenCalled();
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('password');
      expect(res.body[0]).not.toHaveProperty('accessTokenEncrypted');
    });

    it('rejects ADMIN with 403', async () => {
      const token = signToken('ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(auditLogServiceMock.list).not.toHaveBeenCalled();
    });

    it('rejects a SUPER_ADMIN scoped to a company with 403', async () => {
      const token = signToken('SUPER_ADMIN', 'company-a');

      await request(app.getHttpServer())
        .get('/api/platform/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(auditLogServiceMock.list).not.toHaveBeenCalled();
    });

    it('rejects a request without a token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/platform/audit-logs')
        .expect(401);

      expect(auditLogServiceMock.list).not.toHaveBeenCalled();
    });

    it('forwards action, affectedCompanyId, and actorUserId filters', async () => {
      auditLogServiceMock.list.mockResolvedValue([]);
      const token = signToken('SUPER_ADMIN', null);

      await request(app.getHttpServer())
        .get('/api/platform/audit-logs')
        .query({
          action: 'CREATE_COMPANY',
          affectedCompanyId: 'company-a',
          actorUserId: 'super-admin-1',
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(auditLogServiceMock.list).toHaveBeenCalledWith({
        action: 'CREATE_COMPANY',
        affectedCompanyId: 'company-a',
        actorUserId: 'super-admin-1',
      });
    });
  });
});
