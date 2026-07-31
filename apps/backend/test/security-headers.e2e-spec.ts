import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applySecurityHeaders } from '../src/common/security/security.setup';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from '../src/common/logging/request-id.middleware';

@Controller()
class ProbeController {
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: body };
  }

  @Get('boom')
  boom() {
    // An UNEXPECTED (non-HttpException) error → must become a generic 500.
    throw new Error(
      'internal detail: secret-connection-string password=hunter2',
    );
  }
}

describe('Security headers + error shaping (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Mirror main.ts's shared setup so we test the REAL header config.
    const rid = new RequestIdMiddleware();
    app.use((req: any, res: any, next: any) => rid.use(req, res, next));
    applySecurityHeaders(app);
    (app as NestExpressApplication).useBodyParser('json', { limit: '1kb' });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => await app.close());

  it('sets the core security headers on a normal response', async () => {
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
  });

  it('removes the X-Powered-By header', async () => {
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('stamps a correlation id and echoes a supplied one', async () => {
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-request-id']).toBeTruthy();

    const supplied = 'test-correlation-123';
    const res2 = await request(app.getHttpServer())
      .get('/ping')
      .set('X-Request-Id', supplied)
      .expect(200);
    expect(res2.headers['x-request-id']).toBe(supplied);
  });

  it('returns a generic 500 with NO stack/detail leak for an unhandled error', async () => {
    const res = await request(app.getHttpServer()).get('/boom').expect(500);
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('secret-connection-string');
    expect(raw).not.toContain('stack');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('rejects an over-limit JSON body with 413', async () => {
    const huge = { data: 'x'.repeat(4096) }; // > 1kb limit
    await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(huge)
      .expect(413);
  });
});
