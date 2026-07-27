import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ContactsModule } from '../contacts/contacts.module';
import { AutomationsModule } from '../automations/automations.module';
import { WhatsAppIntegrationModule } from '../whatsapp-integration/whatsapp-integration.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ConversationsModule,
    MessagesModule,
    ContactsModule,
    AutomationsModule,
    WhatsAppIntegrationModule,
    NotificationsModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WhatsAppSignatureGuard],
})
export class WebhookModule {}
