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
import type { Request as ExpressRequest, Response } from 'express';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { buildSessionRequestContext } from '../sessions/utils/request-context.util';
import {
  REFRESH_TOKEN_COOKIE,
  SESSION_INACTIVITY_EXPIRY_MS,
} from '../sessions/sessions.constants';

const REFRESH_COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Deprecated in favor of POST /onboarding/company, which also creates the
  // pipeline/stages/agents this endpoint never did. Kept for backward
  // compatibility, but gated the same way so it can no longer create a
  // Company + ADMIN for free.
  @UseGuards(OnboardingInviteGuard)
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

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
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  // Reads the refresh-token cookie (never a body/header token — it must
  // never be reachable from JS given it's httpOnly), rotates it, and mints
  // a fresh access JWT. A missing/invalid/revoked/expired session all fail
  // the same generic way (see AuthService.refresh).
  @Post('refresh')
  async refresh(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const plainRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    const context = buildSessionRequestContext(req);
    const { refreshToken, ...result } = await this.authService.refresh(
      plainRefreshToken,
      context,
    );
    this.setRefreshCookie(res, refreshToken);
    return result;
  }

  // Closes only the session tied to this browser's refresh-token cookie —
  // never other devices. Always clears the cookie client-side regardless
  // of whether a matching session was found server-side.
  @Post('logout')
  async logout(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const plainRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    await this.authService.logout(plainRefreshToken);
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { message: 'Sesión cerrada' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Request() req: any) {
    return this.authService.me(req.user.sub);
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_INACTIVITY_EXPIRY_MS,
      path: REFRESH_COOKIE_PATH,
    });
  }
}
