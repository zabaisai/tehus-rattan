import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';
import { InboundProcessor } from './inbound.processor';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ContactsModule } from '../contacts/contacts.module';
import { AutomationsModule } from '../automations/automations.module';
import { WhatsAppIntegrationModule } from '../whatsapp-integration/whatsapp-integration.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadsModule } from '../leads/leads.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { WhatsAppHistoryModule } from '../whatsapp-history/whatsapp-history.module';

@Module({
  imports: [
    ConversationsModule,
    MessagesModule,
    ContactsModule,
    AutomationsModule,
    WhatsAppIntegrationModule,
    NotificationsModule,
    LeadsModule,
    ChatbotModule,
    WhatsAppHistoryModule,
  ],
  controllers: [WebhookController],
  // InboundProcessor vive aqui y no en QueueModule porque necesita
  // WebhookService, y WebhookModule ya importa QueueModule: al reves habria
  // dependencia circular. Solo arranca de verdad en el worker.
  providers: [WebhookService, WhatsAppSignatureGuard, InboundProcessor],
})
export class WebhookModule {}
