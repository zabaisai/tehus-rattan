import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CAPTCHA_PROVIDER,
  type CaptchaProvider,
  type CaptchaVerifyInput,
} from './captcha.types';

/**
 * Fachada del antibot. El resto del código pregunta a este servicio, no al
 * proveedor. `isEnabled()` decide si el reto está activo (opt-in por entorno);
 * `verify()` delega en el proveedor seleccionado en el módulo.
 */
@Injectable()
export class CaptchaService {
  constructor(
    private readonly config: ConfigService,
    @Inject(CAPTCHA_PROVIDER) private readonly provider: CaptchaProvider,
  ) {}

  /** ¿El control está activo? OPT-IN: solo cuando CAPTCHA_ENABLED === 'true'. */
  isEnabled(): boolean {
    return this.config.get<string>('CAPTCHA_ENABLED')?.trim() === 'true';
  }

  get providerName(): string {
    return this.provider.name;
  }

  async verify(input: CaptchaVerifyInput): Promise<boolean> {
    const result = await this.provider.verify(input);
    return result.success;
  }
}
