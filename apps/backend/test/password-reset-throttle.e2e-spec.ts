// Verifies the per-IP throttle on the password-recovery endpoints. Uses a tiny
// isolated app + a controller throttled to a low limit (like throttling.e2e),
// so it does not depend on the shared THROTTLE config value.
import {
  Body,
  Controller,
  HttpCode,
  INestApplication,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppThrottlerGuard } from '../src/common/throttle/app-throttler.guard';

@Controller('auth')
class ForgotProbeController {
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgot(@Body() _body: unknown) {
    return { message: 'ok' };
  }
}

describe('Password recovery throttling (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 1000 },
        ]),
      ],
      controllers: [ForgotProbeController],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => await app.close());

  it('throttles forgot-password per IP after the limit → 429', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'a@b.co' })
      .expect(200);
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'a@b.co' })
      .expect(200);
    // 3rd within the window from the same IP is blocked
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'a@b.co' })
      .expect(429);
  });
});
