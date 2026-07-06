import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppIntegrationModule } from '../whatsapp-integration/whatsapp-integration.module';

@Module({
  imports: [WhatsAppIntegrationModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
