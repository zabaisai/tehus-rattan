import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildCorsOptions } from '../src/common/security/cors.options';

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

const ALLOWED = 'https://crm-staging.example.com';

async function makeApp(env: Record<string, string>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PingController],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCors(buildCorsOptions(env));
  await app.init();
  return app;
}

describe('CORS (e2e)', () => {
  describe('production allowlist', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await makeApp({ FRONTEND_URL: ALLOWED, NODE_ENV: 'production' });
    });
    afterAll(async () => await app.close());

    it('reflects an allowed Origin with credentials', async () => {
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', ALLOWED)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('never wildcards: a foreign Origin gets NO allow-origin header', async () => {
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://evil.example.com')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects the literal Origin "null"', async () => {
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'null')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows a request with no Origin (server-to-server / probe)', async () => {
      await request(app.getHttpServer()).get('/ping').expect(200);
    });

    it('answers a valid preflight for the allowed Origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/ping')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    // Onboarding: the invite code travels in this header (the guard runs
    // before Multer parses the multipart body), so the preflight must allow
    // it or POST /onboarding/company never leaves the browser.
    it('allows the X-Onboarding-Invite-Code header in the preflight', async () => {
      const res = await request(app.getHttpServer())
        .options('/ping')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,x-onboarding-invite-code',
        )
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(
        res.headers['access-control-allow-headers']?.toLowerCase(),
      ).toContain('x-onboarding-invite-code');
      expect(res.headers['access-control-allow-headers']).not.toContain('*');
    });

    it('does not authorize a preflight from a foreign Origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/ping')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('production fail-closed (no origins configured)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await makeApp({ NODE_ENV: 'production' });
    });
    afterAll(async () => await app.close());

    it('rejects even a plausible frontend Origin when nothing is allowlisted', async () => {
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', ALLOWED)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
