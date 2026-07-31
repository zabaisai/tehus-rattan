import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { InboxService } from './inbox.service';
import { ConversationsController } from './conversations.controller';
import { MessagesModule } from '../messages/messages.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MessagesModule, WhatsappModule, NotificationsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, InboxService],
  exports: [ConversationsService, InboxService],
})
export class ConversationsModule {}
