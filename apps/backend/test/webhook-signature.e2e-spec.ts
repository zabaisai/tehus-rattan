import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { WebhookController } from '../src/modules/webhook/webhook.controller';
import { WebhookService } from '../src/modules/webhook/webhook.service';
import { WhatsAppSignatureGuard } from '../src/modules/webhook/whatsapp-signature.guard';

// Fictitious values — never real Meta credentials, never logged.
const APP_SECRET = 'e2e-test-only-meta-app-secret';
const VERIFY_TOKEN = 'e2e-test-only-verify-token';

const webhookServiceMock = { processWebhook: jest.fn() };

function sign(raw: string): string {
  return (
    'sha256=' +
    createHmac('sha256', APP_SECRET).update(raw, 'utf8').digest('hex')
  );
}

describe('WhatsApp webhook signature (e2e, no real Meta calls)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        WhatsAppSignatureGuard,
        { provide: WebhookService, useValue: webhookServiceMock },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'WHATSAPP_APP_SECRET' ? APP_SECRET : undefined,
          },
        },
      ],
    }).compile();

    // rawBody: true mirrors main.ts so the guard can verify the exact bytes.
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET verify handshake (unchanged)', () => {
    it('echoes the challenge when the verify token matches', async () => {
      await request(app.getHttpServer())
        .get('/api/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '12345',
        })
        .expect(200)
        .expect('12345');
    });

    it('rejects a wrong verify token with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': '12345',
        })
        .expect(403);
    });
  });

  describe('POST receive (signature required)', () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [] } }] }],
    });

    it('accepts a validly-signed payload and reaches the service', async () => {
      await request(app.getHttpServer())
        .post('/api/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(raw))
        .send(raw)
        .expect(200)
        .expect('OK');

      expect(webhookServiceMock.processWebhook).toHaveBeenCalledTimes(1);
    });

    it('rejects a missing signature with 401 and never calls the service', async () => {
      await request(app.getHttpServer())
        .post('/api/webhook')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(401);

      expect(webhookServiceMock.processWebhook).not.toHaveBeenCalled();
    });

    it('rejects an invalid signature with 401 and never calls the service', async () => {
      await request(app.getHttpServer())
        .post('/api/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
        .send(raw)
        .expect(401);

      expect(webhookServiceMock.processWebhook).not.toHaveBeenCalled();
    });

    it('rejects a tampered body (signature valid for different bytes) with 401', async () => {
      const signature = sign(raw);
      const tampered = raw.replace('"messages":[]', '"messages":[{"id":"x"}]');
      await request(app.getHttpServer())
        .post('/api/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(tampered)
        .expect(401);

      expect(webhookServiceMock.processWebhook).not.toHaveBeenCalled();
    });
  });
});
