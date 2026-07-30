import { Module } from '@nestjs/common';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { SupportSessionsController } from './support-sessions.controller';
import { SupportSessionsService } from './support-sessions.service';
import { PlatformActivityController } from './platform-activity.controller';
import { PlatformActivityService } from './platform-activity.service';

@Module({
  controllers: [
    PlatformCompaniesController,
    PlatformAuditLogController,
    SupportSessionsController,
    PlatformActivityController,
  ],
  providers: [
    PlatformCompaniesService,
    PlatformAuditLogService,
    SupportSessionsService,
    PlatformActivityService,
  ],
  // SupportSessionsService is exported so support-gated endpoints living in
  // other modules can re-validate the session server-side. It does NOT widen
  // what support mode can read — only who may re-check that a session is live.
  exports: [PlatformAuditLogService, SupportSessionsService],
})
export class PlatformModule {}
