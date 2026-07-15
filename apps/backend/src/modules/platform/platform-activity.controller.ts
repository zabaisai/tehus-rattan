import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { PlatformActivityService } from './platform-activity.service';

// Same guard combination as every other platform-only endpoint: valid JWT,
// then role === SUPER_ADMIN && companyId === null. An ADMIN — even one who
// somehow guesses these URLs — is rejected with 403 by PlatformGuard itself,
// not by anything in the frontend.
@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform')
export class PlatformActivityController {
  constructor(private activityService: PlatformActivityService) {}

  @Get('activity/summary')
  summary() {
    return this.activityService.getSummary();
  }

  @Get('companies/:companyId/activity')
  companyActivity(@Param('companyId') companyId: string) {
    return this.activityService.getCompanyActivity(companyId);
  }

  @Get('companies/:companyId/sessions')
  companySessions(
    @Param('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('deviceType') deviceType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.activityService.listCompanySessions(companyId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      userId,
      status,
      deviceType,
      dateFrom,
      dateTo,
    });
  }

  @Post('sessions/:sessionId/revoke')
  revokeSession(@Param('sessionId') sessionId: string, @Request() req: any) {
    return this.activityService.revokeSession(
      sessionId,
      this.actorFromRequest(req),
    );
  }

  @Post('users/:userId/sessions/revoke-all')
  revokeAllForUser(@Param('userId') userId: string, @Request() req: any) {
    return this.activityService.revokeAllSessionsForUser(
      userId,
      this.actorFromRequest(req),
    );
  }

  @Post('companies/:companyId/sessions/revoke-all')
  revokeAllForCompany(
    @Param('companyId') companyId: string,
    @Request() req: any,
  ) {
    return this.activityService.revokeAllSessionsForCompany(
      companyId,
      this.actorFromRequest(req),
    );
  }

  private actorFromRequest(req: any) {
    return {
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    };
  }
}
