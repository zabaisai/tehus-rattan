import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { PipelineRetiroService } from './pipeline-retiro.service';
import { PipelineController } from './pipeline.controller';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [PipelineController],
  providers: [PipelineService, PipelineRetiroService, PlatformAuditLogService],
  exports: [PipelineService],
})
export class PipelineModule {}
