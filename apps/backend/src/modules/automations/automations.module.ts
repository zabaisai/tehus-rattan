import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WhatsappService } from './whatsapp.service';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [ConversationsModule, MessagesModule, ContactsModule],
  controllers: [WebhookController, AutomationsController],
  providers: [WebhookService, WhatsappService, AutomationsService],
  exports: [WhatsappService, AutomationsService],
})
export class AutomationsModule {}
