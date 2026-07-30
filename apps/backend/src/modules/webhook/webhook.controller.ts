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
import type { Response } from 'express';
import { WebhookService } from './webhook.service';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';
import {
  THROTTLE_TTL_MS,
  THROTTLE_LIMITS,
} from '../../common/throttle/throttle.config';

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
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      this.logger.log('Webhook verificado correctamente');
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
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
  receive(@Body() body: any, @Res() res: Response) {
    res.status(200).send('OK');
    this.webhookService.processWebhook(body);
  }
}
