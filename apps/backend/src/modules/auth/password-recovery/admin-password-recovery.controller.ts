import {
  Controller,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request as ExpressRequest } from 'express';
import { PlatformGuard } from '../../../common/guards/platform.guard';
import { BusinessTenantGuard } from '../../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { getTrustedClientIp, truncateIp } from '../../sessions/utils/ip.util';
import {
  ADMIN_SEND_RESET_MESSAGE,
  PasswordRecoveryService,
  type RecoveryActor,
} from './password-recovery.service';

function actorFrom(req: ExpressRequest & { user?: any }): RecoveryActor {
  return {
    userId: req.user.sub,
    role: req.user.role,
    companyId: req.user.companyId ?? null,
  };
}

// SUPER_ADMIN: send a recovery email for ANY active user. Never returns the
// token/link — only a confirmation that the request was registered.
@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/users')
export class PlatformPasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  @HttpCode(200)
  @Post(':userId/send-password-reset')
  async send(
    @Param('userId') userId: string,
    @Request() req: ExpressRequest & { user?: any },
  ) {
    const ipPreview = truncateIp(getTrustedClientIp(req));
    await this.recovery.adminSendReset(actorFrom(req), userId, ipPreview);
    return { message: ADMIN_SEND_RESET_MESSAGE };
  }
}

// ADMIN: send a recovery email ONLY for an AGENT of the admin's own company.
// BusinessTenantGuard requires a companyId (so a SUPER_ADMIN — companyId null —
// cannot reach this route and uses the platform endpoint instead); the
// role/tenant match is re-checked in the service.
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('users')
export class AdminPasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  @Roles('ADMIN')
  @HttpCode(200)
  @Post(':userId/send-password-reset')
  async send(
    @Param('userId') userId: string,
    @Request() req: ExpressRequest & { user?: any },
  ) {
    const ipPreview = truncateIp(getTrustedClientIp(req));
    await this.recovery.adminSendReset(actorFrom(req), userId, ipPreview);
    return { message: ADMIN_SEND_RESET_MESSAGE };
  }
}
