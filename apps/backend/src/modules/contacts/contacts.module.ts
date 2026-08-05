import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, PlatformAuditLogService],
  exports: [ContactsService],
})
export class ContactsModule {}
