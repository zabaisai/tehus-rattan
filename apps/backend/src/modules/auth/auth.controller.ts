import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Res,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { CookieOriginGuard } from '../../common/guards/cookie-origin.guard';
import {
  THROTTLE_TTL_MS,
  THROTTLE_LIMITS,
} from '../../common/throttle/throttle.config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { buildSessionRequestContext } from '../sessions/utils/request-context.util';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  clearLegacyRefreshTokenCookie,
  readRefreshTokenCookie,
} from '../sessions/utils/refresh-cookie.util';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Company + ADMIN provisioning is done exclusively through
  // POST /onboarding/company, which performs the real database-backed
  // invitation validation and atomic claim. The former POST /auth/register
  // endpoint was removed: it created a Company + ADMIN without validating the
  // invitation code against the database, so any non-empty string passed its
  // guard.

  @Throttle({ default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.auth } })
  @UseGuards(CookieOriginGuard)
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = buildSessionRequestContext(req);
    const { refreshToken, ...result } = await this.authService.login(
      body.email,
      body.password,
      context,
    );
    setRefreshTokenCookie(res, refreshToken);
    return result;
  }

  // Reads the refresh-token cookie (never a body/header token — it must
  // never be reachable from JS given it's httpOnly), rotates it, and mints
  // a fresh access JWT. A missing/invalid/revoked/expired session all fail
  // the same generic way (see AuthService.refresh).
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.refresh },
  })
  @UseGuards(CookieOriginGuard)
  @Post('refresh')
  async refresh(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Canonical `takto_refresh_token` first; the legacy `tehus_*` cookie is
    // accepted for one rotation and then retired, so a session opened before
    // the rename migrates onto the new name without logging anyone out.
    const { value: plainRefreshToken, fromLegacy } =
      readRefreshTokenCookie(req);
    const context = buildSessionRequestContext(req);
    const { refreshToken, ...result } = await this.authService.refresh(
      plainRefreshToken,
      context,
    );
    setRefreshTokenCookie(res, refreshToken);
    if (fromLegacy) clearLegacyRefreshTokenCookie(res);
    return result;
  }

  // Closes only the session tied to this browser's refresh-token cookie —
  // never other devices. Always clears the cookie client-side regardless
  // of whether a matching session was found server-side.
  @UseGuards(CookieOriginGuard)
  @Post('logout')
  async logout(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { value: plainRefreshToken } = readRefreshTokenCookie(req);
    await this.authService.logout(plainRefreshToken);
    // Clears the canonical AND the legacy cookie name.
    clearRefreshTokenCookie(res);
    return { message: 'Sesión cerrada' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Request() req: any) {
    return this.authService.me(req.user.sub);
  }
}
