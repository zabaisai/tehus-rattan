import { Module } from '@nestjs/common';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';

@Module({
  providers: [WhatsAppIntegrationService],
  exports: [WhatsAppIntegrationService],
})
export class WhatsAppIntegrationModule {}
