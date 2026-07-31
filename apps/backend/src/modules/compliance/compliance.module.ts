import { Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, PlatformAuditLogService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
