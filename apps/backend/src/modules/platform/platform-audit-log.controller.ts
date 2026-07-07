import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { PlatformAuditLogService } from './platform-audit-log.service';

@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/audit-logs')
export class PlatformAuditLogController {
  constructor(private auditLogService: PlatformAuditLogService) {}

  @Get()
  list(
    @Query('action') action?: string,
    @Query('affectedCompanyId') affectedCompanyId?: string,
    @Query('actorUserId') actorUserId?: string,
  ) {
    return this.auditLogService.list({ action, affectedCompanyId, actorUserId });
  }
}
