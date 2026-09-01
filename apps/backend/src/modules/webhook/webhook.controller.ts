import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { WebhookService } from './webhook.service';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';
import { Public } from '../../common/auth/public.decorator';
import {
  THROTTLE_TTL_MS,
  THROTTLE_LIMITS,
} from '../../common/throttle/throttle.config';

// Webhook de Meta: público (Meta no manda JWT). El GET valida el verify token
// (fail-closed) y el POST el HMAC X-Hub-Signature-256 (WhatsAppSignatureGuard).
@Public()
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

  // Writes the response through @Res() and returns NOTHING. Returning the
  // Express Response object here is not cosmetic: the global
  // ClassSerializerInterceptor (main.ts) would try to serialize it, walk its
  // socket and throw, and the global filter would then write after the headers
  // were already sent — which takes the whole process down on socket detach.
  // Covered by test/webhook-verify.e2e-spec.ts.
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.webhookVerify },
  })
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    // text/plain, never text/html: res.send(string) would otherwise default to
    // HTML and reflect the attacker-supplied hub.challenge as a document.
    res.type('text/plain');

    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    // Fail closed: with no configured verify token there is no handshake to
    // pass. Without this an unset token turns `undefined === undefined` into a
    // 200 that reflects arbitrary hub.challenge input.
    if (
      mode === 'subscribe' &&
      expected &&
      this.tokenMatches(token, expected)
    ) {
      // hub.challenge es un token OPACO que genera Meta y que solo devolvemos
      // tal cual. Antes de reflejarlo se valida contra una allowlist estricta:
      // caracteres de token URL-safe ([A-Za-z0-9_-]) y longitud acotada. Ese
      // conjunto es un superconjunto de cualquier challenge real de Meta (un
      // token alfanumérico aleatorio) y EXCLUYE todos los metacaracteres de
      // HTML/JS (`<`, `>`, `&`, `"`, `'`, `/`, espacios y saltos de línea), de
      // modo que el valor reflejado nunca puede formar marcado ni salir del
      // cuerpo text/plain. No cambia el handshake oficial: un challenge legítimo
      // pasa intacto.
      this.logger.log('Webhook verificado correctamente');
      // Caso sin challenge: se responde con cuerpo vacío (Meta siempre lo
      // envía; esto solo preserva el comportamiento previo sin reflejar nada).
      if (challenge === undefined || challenge === '') {
        res.status(200).send('');
        return;
      }
      // Guarda-sanitizador AISLADA: la única salida hacia `res.send` del valor
      // reflejado está dominada por este test de allowlist. Al no ir combinada
      // con otra condición, CodeQL la reconoce como barrera de la ruta
      // reflected-XSS y un challenge presente pero inválido se rechaza (400).
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(challenge)) {
        res.status(400).send('Bad Request');
        return;
      }
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  }

  // Constant-time comparison of the verify token, mirroring the HMAC path's
  // timingSafeEqual. Length is checked first so the compare never throws and a
  // length mismatch is not itself a timing side channel.
  private tokenMatches(received: unknown, expected: string): boolean {
    if (typeof received !== 'string') return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // WhatsAppSignatureGuard verifies the X-Hub-Signature-256 HMAC against the
  // raw body BEFORE this handler runs, so processWebhook is never reached for
  // an unsigned/forged payload. On a valid signature we ack Meta with 200
  // immediately and process asynchronously (Meta retries on slow acks).
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.webhook },
  })
  @UseGuards(WhatsAppSignatureGuard)
  @Post()
  // `body: any` DELIBERADO: el payload lo define Meta, no un DTO nuestro, y ya
  // viene autenticado por el HMAC X-Hub-Signature-256 (WhatsAppSignatureGuard)
  // sobre el cuerpo crudo antes de llegar aquí. Validarlo con class-validator
  // rechazaría formatos nuevos legítimos de Meta; el parser interno lo navega
  // defensivamente campo a campo.
  receive(@Body() body: any, @Res() res: Response) {
    res.status(200).send('OK');
    // `void` deliberado: el ack a Meta ya salió y el procesamiento continúa
    // en segundo plano. Esperarlo aquí retrasaría la respuesta y provocaría
    // reintentos de Meta, que es justo lo que la cola viene a evitar.
    // processWebhook nunca rechaza: aísla los fallos por mensaje.
    void this.webhookService.processWebhook(body);
  }
}
