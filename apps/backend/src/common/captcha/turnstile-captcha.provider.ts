import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type {
  CaptchaProvider,
  CaptchaResult,
  CaptchaVerifyInput,
} from './captcha.types';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Cloudflare Turnstile — verificación SERVER-SIDE.
 *
 * El secret vive SOLO en el backend (`TURNSTILE_SECRET_KEY`); la site key es
 * pública y va en el frontend. La verificación es fail-closed: cualquier fallo
 * de red, timeout o respuesta no-exitosa devuelve `success:false`, de modo que
 * el guard (cuando el control es obligatorio) bloquea el flujo. Nunca se registra
 * el token ni el secret.
 */
@Injectable()
export class TurnstileCaptchaProvider implements CaptchaProvider {
  readonly name = 'turnstile';
  private readonly logger = new Logger(TurnstileCaptchaProvider.name);

  constructor(private readonly config: ConfigService) {}

  async verify(input: CaptchaVerifyInput): Promise<CaptchaResult> {
    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY');
    if (!secret?.trim()) {
      // Fail-closed: sin secret no se puede verificar nada.
      return { success: false, reason: 'NO_SECRET' };
    }
    if (!input.token?.trim()) {
      return { success: false, reason: 'NO_TOKEN' };
    }

    const timeoutMs = this.timeoutMs();
    try {
      const body = new URLSearchParams();
      body.set('secret', secret);
      body.set('response', input.token);
      if (input.remoteIp) body.set('remoteip', input.remoteIp);

      const res = await axios.post(SITEVERIFY_URL, body.toString(), {
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // No seguir redirecciones a hosts inesperados.
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 500,
      });

      const data = res.data as {
        success?: boolean;
        action?: string;
        hostname?: string;
        'error-codes'?: string[];
      };

      if (!data?.success) {
        // Se registra SOLO el clasificador de error de Cloudflare, nunca el token.
        return {
          success: false,
          reason: (data?.['error-codes'] ?? []).join(',') || 'VERIFY_FAILED',
        };
      }

      // Validación de action cuando se espera una concreta.
      if (input.expectedAction && data.action !== input.expectedAction) {
        return { success: false, reason: 'ACTION_MISMATCH' };
      }

      const allowedHostname = this.config
        .get<string>('TURNSTILE_EXPECTED_HOSTNAME')
        ?.trim();
      if (allowedHostname && data.hostname !== allowedHostname) {
        return { success: false, reason: 'HOSTNAME_MISMATCH' };
      }

      return { success: true };
    } catch (error) {
      // Fail-closed en timeout / red: no se filtra el token en el log.
      this.logger.warn(
        `Turnstile verify failed [${(error as { code?: string })?.code ?? 'ERROR'}]`,
      );
      return { success: false, reason: 'VERIFY_ERROR' };
    }
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>('TURNSTILE_TIMEOUT_MS'));
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }
}
