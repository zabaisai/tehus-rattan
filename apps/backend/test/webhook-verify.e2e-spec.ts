import {
  ClassSerializerInterceptor,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { WebhookController } from '../src/modules/webhook/webhook.controller';
import { WebhookService } from '../src/modules/webhook/webhook.service';
import { WhatsAppSignatureGuard } from '../src/modules/webhook/whatsapp-signature.guard';

// Fictitious values — never real Meta credentials, never logged.
const APP_SECRET = 'e2e-test-only-meta-app-secret';
const VERIFY_TOKEN = 'e2e-test-only-verify-token';

const webhookServiceMock = { processWebhook: jest.fn() };

/**
 * Regression guard for Meta's GET verification handshake.
 *
 * webhook-signature.e2e-spec.ts already covers the handshake's status codes,
 * but it boots a bare app. This spec deliberately mirrors the GLOBALS from
 * main.ts — the global ClassSerializerInterceptor and AllExceptionsFilter —
 * because the handshake's failure mode only exists when they are present:
 * if the handler returns the Express Response object, the serializer walks it
 * (and its socket) and throws, the filter then writes after headers are sent
 * (ERR_HTTP_HEADERS_SENT), and Node aborts the process on socket detach.
 * The client still sees the correct status, so status assertions alone cannot
 * catch it — each case therefore also asserts that the app is still serving
 * AND that the global exception filter never logged a 500 for the handshake.
 */
describe('WhatsApp webhook GET verify handshake, with main.ts globals (e2e)', () => {
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

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.setGlobalPrefix('api');
    // The two globals that turn a returned Response object into a hard crash.
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  let errorLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // AllExceptionsFilter logs every 5xx through Logger#error. The handshake
    // must never produce one — that log line IS the crash signature, and it
    // appears even though the client already received the right status.
    errorLogSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    expect(errorLogSpy).not.toHaveBeenCalled();
    errorLogSpy.mockRestore();
  });

  // Proves the previous request did not kill the HTTP layer: a crashed/
  // detached socket makes this follow-up fail instead of echoing the challenge.
  async function expectServerStillAlive() {
    await request(app.getHttpServer())
      .get('/api/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'still-alive',
      })
      .expect(200)
      .expect('still-alive');
  }

  it('valid token: echoes the challenge with 200 and keeps serving', async () => {
    await request(app.getHttpServer())
      .get('/api/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'challenge-abc',
      })
      .expect(200)
      .expect('challenge-abc');

    await expectServerStillAlive();
  });

  it('invalid token: answers 403 and keeps serving', async () => {
    await request(app.getHttpServer())
      .get('/api/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-abc',
      })
      .expect(403)
      .expect('Forbidden');

    await expectServerStillAlive();
  });

  it('missing params: answers 403 and keeps serving', async () => {
    // Exactly the shape of a bare probe (no hub.* query at all) — the request
    // that took the staging backend down.
    await request(app.getHttpServer())
      .get('/api/webhook')
      .expect(403)
      .expect('Forbidden');

    await expectServerStillAlive();
  });

  it('valid token but no challenge: answers 200 with an empty body, no crash', async () => {
    // Documents today's behavior for a partial query (Meta always sends
    // hub.challenge). The point of the case is the absence of a 500, not the
    // body — this fix deliberately changes no handshake semantics.
    await request(app.getHttpServer())
      .get('/api/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN })
      .expect(200)
      .expect('');

    await expectServerStillAlive();
  });

  it('never lets the handler return the Response object to the interceptor', () => {
    // The invariant behind every case above, asserted directly: a handler that
    // returns `res` is what the global serializer chokes on.
    const controller = new WebhookController(
      webhookServiceMock as unknown as WebhookService,
    );
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    const returned = controller.verify(
      'subscribe',
      VERIFY_TOKEN,
      'challenge-abc',
      res as never,
    );

    expect(returned).toBeUndefined();
  });
});
