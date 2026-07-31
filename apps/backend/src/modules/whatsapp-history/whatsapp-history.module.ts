import { Module } from '@nestjs/common';
import { HistorySyncService } from './history-sync.service';
import { HistoryImportService } from './history-import.service';
import { HistoryImportController } from './history-import.controller';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ContactsModule, ConversationsModule],
  controllers: [HistoryImportController],
  providers: [HistorySyncService, HistoryImportService],
  exports: [HistorySyncService, HistoryImportService],
})
export class WhatsAppHistoryModule {}
