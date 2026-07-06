import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ContactsModule } from '../contacts/contacts.module';
import { AutomationsModule } from '../automations/automations.module';
import { WhatsAppIntegrationModule } from '../whatsapp-integration/whatsapp-integration.module';

@Module({
  imports: [
    ConversationsModule,
    MessagesModule,
    ContactsModule,
    AutomationsModule,
    WhatsAppIntegrationModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
