import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { CaptchaService } from './captcha.service';
import { getTrustedClientIp } from '../../modules/sessions/utils/ip.util';

const TOKEN_HEADER = 'x-captcha-token';
const TOKEN_BODY_FIELD = 'captchaToken';

/**
 * Guard antibot. Cuando el control está DESACTIVADO (por defecto) es un no-op:
 * el flujo normal no se ve afectado. Cuando está activado es FAIL-CLOSED: sin
 * token válido, 403. El token se lee de la cabecera `x-captcha-token` o del
 * campo `captchaToken` del body; se verifica server-side y nunca se registra.
 */
@Injectable()
export class CaptchaGuard implements CanActivate {
  constructor(private readonly captcha: CaptchaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.captcha.isEnabled()) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[TOKEN_HEADER];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const fromBody = (request.body as Record<string, unknown> | undefined)?.[
      TOKEN_BODY_FIELD
    ];
    const token =
      (typeof fromHeader === 'string' && fromHeader) ||
      (typeof fromBody === 'string' && fromBody) ||
      '';

    if (!token) {
      throw new ForbiddenException('Verificación antibot requerida');
    }

    const ok = await this.captcha.verify({
      token,
      remoteIp: getTrustedClientIp(request),
    });
    if (!ok) {
      throw new ForbiddenException('Verificación antibot fallida');
    }
    return true;
  }
}
