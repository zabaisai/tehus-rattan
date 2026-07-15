import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { InvitationCodesService } from './invitation-codes.service';
import { CreateInvitationCodeDto } from './dto/create-invitation-code.dto';

// PlatformGuard requires role SUPER_ADMIN AND companyId null — the same
// guard already used for /platform/companies, so ADMIN, AGENT, and any
// company-scoped user (including a company-scoped SUPER_ADMIN, if one ever
// existed) are rejected with 403 regardless of what the frontend shows.
@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('admin/invitation-codes')
export class InvitationCodesController {
  constructor(private invitationCodesService: InvitationCodesService) {}

  @Post()
  create(@Body() dto: CreateInvitationCodeDto, @Request() req: any) {
    return this.invitationCodesService.create(dto, this.actorFromRequest(req));
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.invitationCodesService.list({ status });
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string, @Request() req: any) {
    return this.invitationCodesService.revoke(id, this.actorFromRequest(req));
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
