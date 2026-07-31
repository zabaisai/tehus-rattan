import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  SkipThrottle,
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';
import request from 'supertest';

// A tiny app that mirrors the real throttling wiring (global ThrottlerGuard +
// per-route @Throttle / @SkipThrottle), so the mechanism is tested
// deterministically — limits are request-count based within the window, so no
// timers/sleeps are needed, and each test builds a fresh app (fresh in-memory
// storage) for a clean rate-limiter state.
@Controller()
class StubController {
  @SkipThrottle()
  @Get('health')
  health() {
    return { ok: true };
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('login')
  login() {
    return { ok: true };
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('refresh')
  refresh() {
    return { ok: true };
  }

  @Get('normal')
  normal() {
    return { ok: true };
  }
}

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ],
    controllers: [StubController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // Mirror main.ts so req.ip is derived from the single proxy hop's
  // X-Forwarded-For, not blindly trusted from an arbitrary chain.
  app.set('trust proxy', 1);
  await app.init();
  return app;
}

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows requests up to the login limit, then returns 429 with Retry-After', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) {
      await request(server).post('/login').expect(201);
    }
    const blocked = await request(server).post('/login').expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('throttles refresh independently from login (separate counters)', async () => {
    const server = app.getHttpServer();
    // Exhaust login.
    for (let i = 0; i < 3; i++) await request(server).post('/login');
    await request(server).post('/login').expect(429);
    // Refresh has its own bucket and higher limit — still available.
    for (let i = 0; i < 5; i++)
      await request(server).post('/refresh').expect(201);
    await request(server).post('/refresh').expect(429);
  });

  it('never throttles the @SkipThrottle health endpoint', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 20; i++) {
      await request(server).get('/health').expect(200);
    }
  });

  it('lets normal endpoints run under the generous global default limit', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 30; i++) {
      await request(server).get('/normal').expect(200);
    }
  });

  it('throttles per forwarded client IP (respects trust proxy), not globally', async () => {
    const server = app.getHttpServer();
    // Client A exhausts its login budget.
    for (let i = 0; i < 3; i++) {
      await request(server)
        .post('/login')
        .set('X-Forwarded-For', '1.1.1.1')
        .expect(201);
    }
    await request(server)
      .post('/login')
      .set('X-Forwarded-For', '1.1.1.1')
      .expect(429);
    // A different client IP is unaffected.
    await request(server)
      .post('/login')
      .set('X-Forwarded-For', '2.2.2.2')
      .expect(201);
  });
});
