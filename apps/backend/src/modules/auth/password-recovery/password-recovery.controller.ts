import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CookieOriginGuard } from '../../../common/guards/cookie-origin.guard';
import {
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from '../../../common/throttle/throttle.config';
import { getTrustedClientIp, truncateIp } from '../../sessions/utils/ip.util';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  PasswordRecoveryService,
  RESET_PASSWORD_SUCCESS_MESSAGE,
} from './password-recovery.service';

// Public, unauthenticated recovery endpoints. Origin/CSRF is enforced by
// CookieOriginGuard (same as login), and both are per-IP throttled. Neither
// returns anything that could confirm an account exists.
@Controller('auth')
export class PasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.passwordReset },
  })
  @UseGuards(CookieOriginGuard)
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ipPreview = truncateIp(getTrustedClientIp(req));
    await this.recovery.requestReset(dto.email, ipPreview);
    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }

  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.passwordReset },
  })
  @UseGuards(CookieOriginGuard)
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    const ipPreview = truncateIp(getTrustedClientIp(req));
    await this.recovery.resetPassword(
      dto.token,
      dto.password,
      dto.passwordConfirmation,
      ipPreview,
    );
    return { message: RESET_PASSWORD_SUCCESS_MESSAGE };
  }
}
