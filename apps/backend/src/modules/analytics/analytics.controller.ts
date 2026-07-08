import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('overview')
  getOverview(@Request() req: any) {
    return this.analyticsService.getOverview(req.user.companyId);
  }

  @Get('leads-by-stage')
  getLeadsByStage(
    @Request() req: any,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.analyticsService.getLeadsByStage(
      req.user.companyId,
      pipelineId,
    );
  }

  @Get('agent-performance')
  getAgentPerformance(@Request() req: any) {
    return this.analyticsService.getAgentPerformance(req.user.companyId);
  }

  @Get('lost-reasons')
  getLostReasons(@Request() req: any) {
    return this.analyticsService.getLostReasons(req.user.companyId);
  }

  @Get('tasks-overdue')
  async getOverdueTasksCount(@Request() req: any) {
    const count = await this.analyticsService.getOverdueTasksCount(
      req.user.companyId,
    );
    return { count };
  }

  @Get('conversations-pending')
  async getPendingConversationsCount(@Request() req: any) {
    const count = await this.analyticsService.getPendingConversationsCount(
      req.user.companyId,
    );
    return { count };
  }
}
