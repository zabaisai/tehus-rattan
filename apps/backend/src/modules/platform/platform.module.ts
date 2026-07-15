import { Module } from '@nestjs/common';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { SupportSessionsController } from './support-sessions.controller';
import { SupportSessionsService } from './support-sessions.service';

@Module({
  controllers: [
    PlatformCompaniesController,
    PlatformAuditLogController,
    SupportSessionsController,
  ],
  providers: [
    PlatformCompaniesService,
    PlatformAuditLogService,
    SupportSessionsService,
  ],
  exports: [PlatformAuditLogService],
})
export class PlatformModule {}
