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
import { REFRESH_TOKEN_COOKIE } from '../sessions/sessions.constants';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from '../sessions/utils/refresh-cookie.util';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Deprecated in favor of POST /onboarding/company, which also creates the
  // pipeline/stages/agents this endpoint never did. Kept for backward
  // compatibility, but gated the same way so it can no longer create a
  // Company + ADMIN for free.
  //
  // Deliberately NOT wired into session tracking: this path issues a
  // sid-less access token via AuthService.issueSession(user) with no
  // second argument, and JwtStrategy now rejects any token with no `sid`
  // outright (see jwt.strategy.ts) — so the token this endpoint returns
  // authenticates nothing against any guarded route. It is fully inert,
  // not merely "legacy"; this is intentional rather than an oversight.
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
    setRefreshTokenCookie(res, refreshToken);
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
    setRefreshTokenCookie(res, refreshToken);
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
    clearRefreshTokenCookie(res);
    return { message: 'Sesión cerrada' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Request() req: any) {
    return this.authService.me(req.user.sub);
  }
}
