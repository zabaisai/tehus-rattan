import { Module } from '@nestjs/common';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';

@Module({
  providers: [WhatsAppIntegrationService, WhatsAppTokenCryptoService],
  exports: [WhatsAppIntegrationService, WhatsAppTokenCryptoService],
})
export class WhatsAppIntegrationModule {}
