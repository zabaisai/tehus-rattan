import { Injectable } from '@nestjs/common';
import type {
  CaptchaProvider,
  CaptchaResult,
  CaptchaVerifyInput,
} from './captcha.types';

// Tokens deterministas para local/tests. Un E2E manda PASS_TOKEN para pasar el
// reto sin depender de Cloudflare, y FAIL_TOKEN para probar el rechazo.
export const FAKE_CAPTCHA_PASS_TOKEN = 'test-captcha-pass';
export const FAKE_CAPTCHA_FAIL_TOKEN = 'test-captcha-fail';

/**
 * Adaptador falso EXPLÍCITO. No contacta ningún servicio externo. Existe para
 * que el flujo protegido se pueda ejercitar en local y en pruebas de forma
 * determinista. NUNCA debe usarse en producción: la selección del proveedor
 * (captcha.module) exige Turnstile cuando el control es obligatorio en prod.
 */
@Injectable()
export class FakeCaptchaProvider implements CaptchaProvider {
  readonly name = 'fake';

  verify(input: CaptchaVerifyInput): Promise<CaptchaResult> {
    if (input.token === FAKE_CAPTCHA_PASS_TOKEN) {
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({ success: false, reason: 'FAKE_REJECTED' });
  }
}
