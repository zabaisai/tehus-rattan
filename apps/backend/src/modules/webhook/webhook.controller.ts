import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      this.logger.log('Webhook verificado correctamente');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  @Post()
  receive(@Body() body: any, @Res() res: Response) {
    res.status(200).send('OK');
    this.webhookService.processWebhook(body);
  }
}
