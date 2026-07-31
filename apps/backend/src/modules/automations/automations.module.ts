import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationRunsService } from './automation-runs.service';
import { AutomationsController } from './automations.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [ConversationsModule, MessagesModule, WhatsappModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationRunsService],
  exports: [AutomationsService, AutomationRunsService],
})
export class AutomationsModule {}
