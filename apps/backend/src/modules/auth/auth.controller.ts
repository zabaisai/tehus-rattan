import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
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
import {
  ResendDeviceVerificationDto,
  VerifyDeviceDto,
} from './dto/verify-device.dto';
import {
  clearTrustedDeviceCookie,
  readTrustedDeviceCookie,
  setTrustedDeviceCookie,
} from './device-verification/trusted-device-cookie.util';
import { TrustedDeviceService } from './device-verification/trusted-device.service';
import { buildSessionRequestContext } from '../sessions/utils/request-context.util';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  clearLegacyRefreshTokenCookie,
  readRefreshTokenCookie,
} from '../sessions/utils/refresh-cookie.util';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private trustedDevices: TrustedDeviceService,
  ) {}

  // Company + ADMIN provisioning is done exclusively through
  // POST /onboarding/company, which performs the real database-backed
  // invitation validation and atomic claim. The former POST /auth/register
  // endpoint was removed: it created a Company + ADMIN without validating the
  // invitation code against the database, so any non-empty string passed its
  // guard.

  /**
   * Inicio de sesión.
   *
   * Responde una de dos formas, y el cliente distingue por `status`:
   *
   *  - `authenticated`: como siempre, `token` + `user`, con la cookie de
   *    refresh puesta.
   *  - `verification_required`: este dispositivo necesita el código enviado
   *    por correo. NO se emite token ni cookie de sesión; solo viaja el
   *    identificador del reto y el destino enmascarado.
   *
   * Con el interruptor de verificación apagado siempre ocurre lo primero, que
   * es exactamente el comportamiento anterior a la Fase 4.5.
   */
  @Throttle({ default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.auth } })
  @UseGuards(CookieOriginGuard)
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = buildSessionRequestContext(req);
    const resultado = await this.authService.loginWithDeviceVerification(
      body.email,
      body.password,
      context,
      readTrustedDeviceCookie(req),
    );

    if (resultado.outcome === 'verification_required') {
      return { status: 'verification_required', ...resultado.challenge };
    }

    const { outcome: _outcome, refreshToken, ...result } = resultado;
    setRefreshTokenCookie(res, refreshToken);
    return { status: 'authenticated', ...result };
  }

  /**
   * Comprueba el código y, solo si acierta, abre la sesión.
   *
   * Mismo límite de peticiones que el login: probar códigos no puede salir
   * más barato que probar contraseñas.
   */
  @Throttle({ default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.auth } })
  @UseGuards(CookieOriginGuard)
  @Post('verify-device')
  async verifyDevice(
    @Body() body: VerifyDeviceDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = buildSessionRequestContext(req);
    const { refreshToken, trustedDeviceToken, ...result } =
      await this.authService.completeDeviceVerification({
        challengeId: body.challengeId,
        code: body.code,
        trustDevice: body.trustDevice === true,
        context,
      });

    setRefreshTokenCookie(res, refreshToken);
    if (trustedDeviceToken) {
      setTrustedDeviceCookie(res, trustedDeviceToken);
    }
    return { status: 'authenticated', ...result };
  }

  /**
   * Reenvía el código. El servidor decide si ya pasó la espera mínima; el
   * cliente solo muestra la cuenta atrás.
   */
  @Throttle({ default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.auth } })
  @UseGuards(CookieOriginGuard)
  @HttpCode(200)
  @Post('verify-device/resend')
  async resendDeviceVerification(
    @Body() body: ResendDeviceVerificationDto,
    @Req() req: ExpressRequest,
  ) {
    const context = buildSessionRequestContext(req);
    const challenge = await this.authService.resendDeviceVerification(
      body.challengeId,
      context,
    );
    return { status: 'verification_required', ...challenge };
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

  /**
   * Deja de confiar en TODOS los dispositivos de quien lo pide.
   *
   * Cerrar sesión no revoca la confianza —es un dispositivo privado y el
   * segundo factor es del equipo, no de la sesión—, así que esta es la vía
   * explícita para retirarla: tras llamarla, cualquier navegador vuelve a
   * pedir el código. Solo actúa sobre la propia cuenta: el usuario sale del
   * token, nunca del cuerpo.
   */
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('trusted-devices/revoke-all')
  async revokeTrustedDevices(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revocados = await this.trustedDevices.revokeAllForUserAudited({
      id: req.user.sub,
      role: req.user.role,
      companyId: req.user.companyId ?? null,
    });
    clearTrustedDeviceCookie(res);
    return { revoked: revocados };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Request() req: any) {
    return this.authService.me(req.user.sub);
  }
}
