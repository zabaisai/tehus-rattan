import { Module } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { ChatbotFlowsService } from './chatbot-flows.service';
import { ChatbotController } from './chatbot.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MessagesModule } from '../messages/messages.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssignmentModule } from '../assignment/assignment.module';

@Module({
  imports: [
    WhatsappModule,
    MessagesModule,
    NotificationsModule,
    AssignmentModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotFlowsService],
  exports: [ChatbotService, ChatbotFlowsService],
})
export class ChatbotModule {}
