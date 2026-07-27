import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Test-only secret, never read from .env and never logged.
const TEST_JWT_SECRET = 'e2e-test-only-secret-do-not-use-in-prod';

// Exercises the REAL AuthGuard('jwt') + JwtStrategy pipeline end to end via
// GET /api/auth/me (already `@UseGuards(AuthGuard('jwt'))`), with only
// PrismaService and AuthService mocked — same pattern as
// platform-companies.e2e-spec.ts. The point of this suite is proving that
// changing a UserSession's status between two requests carrying the exact
// same, still-unexpired access token changes the outcome of the second one
// — that is "immediate revocation" in the sense this feature promises.
// Session revocation (POST /platform/sessions/:id/revoke), revoke-all-for-
// user, and revoke-all-for-company all reduce to the identical mechanism
// verified here: they flip the same UserSession.status away from ACTIVE,
// which is the one thing JwtStrategy.validate checks — so one test of "an
// ACTIVE session works, a REVOKED one doesn't, same token both times" is
// representative of all three revoke endpoints, not just the single-
// session one.
const authServiceMock = {
  me: jest.fn(),
};

describe('Immediate session revocation via JwtStrategy (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let prismaMock: { userSession: { findUnique: jest.Mock } };

  const signAccessToken = (sid: string) =>
    jwtService.sign(
      {
        sub: 'user-1',
        email: 'admin@company-a.test',
        role: 'ADMIN',
        companyId: 'company-a',
        sid,
      },
      { expiresIn: '15m' },
    );

  beforeAll(async () => {
    prismaMock = { userSession: { findUnique: jest.fn() } };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [AuthController],
      providers: [
        JwtStrategy,
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
              throw new Error(`Unexpected config key requested: ${key}`);
            },
          },
        },
        { provide: PrismaService, useValue: prismaMock },
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

  it('accepts the token while its session is ACTIVE, then rejects the exact same still-unexpired token the instant the session is revoked', async () => {
    authServiceMock.me.mockResolvedValue({ id: 'user-1', name: 'Admin A' });
    const token = signAccessToken('session-1');

    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'ACTIVE',
      revokedAt: null,
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Simulates POST /platform/sessions/:id/revoke (or revoke-all for the
    // user/company) having just run — same status flip, same DB row.
    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'REVOKED',
      revokedAt: new Date(),
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects immediately after a LOGGED_OUT transition too (POST /auth/logout), with the same still-valid token', async () => {
    authServiceMock.me.mockResolvedValue({ id: 'user-1', name: 'Admin A' });
    const token = signAccessToken('session-2');

    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'ACTIVE',
      revokedAt: null,
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'LOGGED_OUT',
      revokedAt: null,
      loggedOutAt: new Date(),
      lastSeenAt: new Date(),
    });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token with no sid claim outright, with 401', async () => {
    const tokenWithoutSid = jwtService.sign(
      {
        sub: 'user-1',
        email: 'admin@company-a.test',
        role: 'ADMIN',
        companyId: 'company-a',
      },
      { expiresIn: '15m' },
    );

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenWithoutSid}`)
      .expect(401);

    expect(prismaMock.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a request with no token at all', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it("revoking every session of a user (POST /platform/users/:id/sessions/revoke-all) invalidates ALL of that user's still-unexpired access tokens immediately", async () => {
    authServiceMock.me.mockResolvedValue({ id: 'user-1', name: 'Admin A' });
    const tokenDeviceA = signAccessToken('session-device-a');
    const tokenDeviceB = signAccessToken('session-device-b');

    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'ACTIVE',
      revokedAt: null,
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenDeviceA}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenDeviceB}`)
      .expect(200);

    // Simulates PlatformActivityService.revokeAllSessionsForUser having
    // just run: every ACTIVE session for this user flips to REVOKED.
    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'REVOKED',
      revokedAt: new Date(),
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenDeviceA}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenDeviceB}`)
      .expect(401);
  });

  it("revoking every session of a company (POST /platform/companies/:id/sessions/revoke-all) invalidates its users' still-unexpired access tokens immediately", async () => {
    authServiceMock.me.mockResolvedValue({ id: 'user-1', name: 'Admin A' });
    const token = signAccessToken('session-company-wide');

    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'ACTIVE',
      revokedAt: null,
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Simulates PlatformActivityService.revokeAllSessionsForCompany having
    // just run against every ACTIVE session in the company.
    prismaMock.userSession.findUnique.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      status: 'REVOKED',
      revokedAt: new Date(),
      loggedOutAt: null,
      lastSeenAt: new Date(),
    });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
