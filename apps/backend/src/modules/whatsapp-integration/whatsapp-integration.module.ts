import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import { WhatsAppEmbeddedSignupStateService } from './whatsapp-embedded-signup-state.service';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';

@Module({
  imports: [PlatformModule],
  controllers: [WhatsAppIntegrationController],
  providers: [
    WhatsAppIntegrationService,
    WhatsAppTokenCryptoService,
    WhatsAppIntegrationManagementService,
    WhatsAppEmbeddedSignupStateService,
    WhatsAppMetaClientService,
    WhatsAppEmbeddedSignupService,
  ],
  exports: [
    WhatsAppIntegrationService,
    WhatsAppTokenCryptoService,
    WhatsAppIntegrationManagementService,
  ],
})
export class WhatsAppIntegrationModule {}
