import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsEliminacionService } from './contacts-eliminacion.service';
import { ContactsController } from './contacts.controller';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [ContactsController],
  providers: [
    ContactsService,
    ContactsEliminacionService,
    PlatformAuditLogService,
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
