import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import { WhatsAppEmbeddedSignupStateService } from './whatsapp-embedded-signup-state.service';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { PlatformWhatsAppIntegrationController } from './platform-whatsapp-integration.controller';
import { PlatformWhatsAppIntegrationService } from './platform-whatsapp-integration.service';

@Module({
  // The support-gated platform controller lives HERE, not in PlatformModule,
  // so the dependency stays one-way (whatsapp -> platform) and no circular
  // import is introduced.
  imports: [PlatformModule, NotificationsModule],
  controllers: [
    WhatsAppIntegrationController,
    PlatformWhatsAppIntegrationController,
  ],
  providers: [
    PlatformWhatsAppIntegrationService,
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
