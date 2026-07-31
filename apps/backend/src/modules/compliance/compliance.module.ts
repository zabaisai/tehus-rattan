import { Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { DeletionService } from './deletion.service';
import { DeletionController } from './deletion.controller';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [ComplianceController, DeletionController],
  providers: [ComplianceService, DeletionService, PlatformAuditLogService],
  exports: [ComplianceService, DeletionService],
})
export class ComplianceModule {}
