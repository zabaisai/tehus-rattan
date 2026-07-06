import { Module } from '@nestjs/common';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';

@Module({
  providers: [
    WhatsAppIntegrationService,
    WhatsAppTokenCryptoService,
    WhatsAppIntegrationManagementService,
  ],
  exports: [
    WhatsAppIntegrationService,
    WhatsAppTokenCryptoService,
    WhatsAppIntegrationManagementService,
  ],
})
export class WhatsAppIntegrationModule {}
