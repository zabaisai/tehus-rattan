import { Controller, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppThrottlerGuard } from '../src/common/throttle/app-throttler.guard';
import { DEVICE_ID_COOKIE } from '../src/modules/sessions/sessions.constants';

// Two routes throttled to a tiny limit so the e2e can hit the ceiling in a few
// requests. Refresh is device-bucketed by AppThrottlerGuard; login is per-IP.
@Controller('auth')
class ThrottleTestController {
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Post('refresh')
  refresh() {
    return { ok: true };
  }

  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Post('login')
  login() {
    return { ok: true };
  }
}

const dev = (id: string) => [`${DEVICE_ID_COOKIE}=${id}`];

describe('Refresh throttling (device vs IP) (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 1000 },
        ]),
      ],
      controllers: [ThrottleTestController],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => await app.close());

  const post = (path: string, cookies?: string[]) => {
    const r = request(app.getHttpServer()).post(path);
    return cookies ? r.set('Cookie', cookies) : r;
  };

  it('caps a single device at its refresh limit', async () => {
    await post('/api/auth/refresh', dev('solo-device')).expect(201);
    await post('/api/auth/refresh', dev('solo-device')).expect(201);
    await post('/api/auth/refresh', dev('solo-device')).expect(429);
  });

  it("does NOT let one device consume another device's budget on the same IP", async () => {
    // Exhaust device A.
    await post('/api/auth/refresh', dev('office-A')).expect(201);
    await post('/api/auth/refresh', dev('office-A')).expect(201);
    await post('/api/auth/refresh', dev('office-A')).expect(429);
    // Device B (same IP, its own cookie) still has a full budget.
    await post('/api/auth/refresh', dev('office-B')).expect(201);
    await post('/api/auth/refresh', dev('office-B')).expect(201);
  });

  it('falls back to a per-IP bucket for refresh when no device-id cookie is sent', async () => {
    await post('/api/auth/refresh').expect(201);
    await post('/api/auth/refresh').expect(201);
    await post('/api/auth/refresh').expect(429);
  });

  it('keeps LOGIN per-IP: different devices on one IP share (and exhaust) the bucket', async () => {
    await post('/api/auth/login', dev('login-A')).expect(201);
    await post('/api/auth/login', dev('login-B')).expect(201);
    // A third login from the same IP is blocked regardless of a fresh device id —
    // device bucketing must never dilute credential brute-force protection.
    await post('/api/auth/login', dev('login-C')).expect(429);
  });
});
