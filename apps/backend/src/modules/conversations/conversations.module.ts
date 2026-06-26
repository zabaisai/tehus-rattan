import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { MessagesModule } from '../messages/messages.module';
import { WhatsappService } from '../automations/whatsapp.service';

@Module({
  imports: [MessagesModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, WhatsappService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
