import { Module } from '@nestjs/common';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformAuditLogService } from './platform-audit-log.service';

@Module({
  controllers: [PlatformCompaniesController, PlatformAuditLogController],
  providers: [PlatformCompaniesService, PlatformAuditLogService],
})
export class PlatformModule {}
