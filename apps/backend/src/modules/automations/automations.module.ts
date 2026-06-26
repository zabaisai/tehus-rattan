import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WhatsappService } from './whatsapp.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [ConversationsModule, MessagesModule, ContactsModule],
  controllers: [WebhookController],
  providers: [WebhookService, WhatsappService],
  exports: [WhatsappService],
})
export class AutomationsModule {}
