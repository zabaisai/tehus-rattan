import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TrustedDeviceService } from './device-verification/trusted-device.service';
import { CookieOriginGuard } from '../../common/guards/cookie-origin.guard';

// Regression guard for the removed legacy endpoint POST /api/auth/register
// (security fix N-1/N-2). This asserts Nest's real HTTP routing — not a text
// search — so it fails the moment anyone re-publishes the route. It boots an
// isolated Nest app with a mocked AuthService: no PostgreSQL, no Redis, no
// Docker, no real data, no secrets, and it never creates a company or user.
describe('POST /api/auth/register (removed legacy endpoint)', () => {
  let app: INestApplication;

  const authServiceMock = {
    loginWithDeviceVerification: jest.fn(),
    // Only login is exercised (as a positive control below); if register were
    // ever wired back it would need a method here too — but the point of this
    // suite is that the ROUTE must not exist regardless.
    login: jest.fn().mockResolvedValue({
      token: 'signed-jwt',
      user: { id: 'u1', email: 'a@co.test', name: 'A' },
      refreshToken: 'plain-refresh-token',
    }),
    refresh: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        // Fase 4.5: el controlador también revoca dispositivos confiables.
        {
          provide: TrustedDeviceService,
          useValue: { revokeAllForUser: jest.fn().mockResolvedValue(0) },
        },
      ],
    })
      // Bypass the Origin allowlist guard so the positive-control login route
      // is reachable without a ConfigService; irrelevant to the 404 assertion.
      .overrideGuard(CookieOriginGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so the tested path is exactly /api/auth/*.
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 404 for POST /api/auth/register (route no longer published)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        companyName: 'Attacker Co',
        name: 'Attacker',
        email: 'attacker@evil.test',
        password: 'whatever-Password-1',
        inviteCode: 'anything',
      })
      .expect(404);
  });

  it('returns 404 for GET /api/auth/register too (no method is published)', async () => {
    await request(app.getHttpServer()).get('/api/auth/register').expect(404);
  });

  it('positive control: POST /api/auth/login is still mounted (not 404), proving the 404 above is route-specific', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a@co.test', password: 'whatever-Password-1' });
    expect(res.status).not.toBe(404);
  });
});
