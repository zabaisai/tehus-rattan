import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CAPTCHA_PROVIDER, type CaptchaProvider } from './captcha.types';
import { CaptchaService } from './captcha.service';
import { CaptchaGuard } from './captcha.guard';
import { FakeCaptchaProvider } from './fake-captcha.provider';
import { TurnstileCaptchaProvider } from './turnstile-captcha.provider';

/**
 * Antibot, global y desacoplado.
 *
 * Selección del proveedor por entorno:
 *   - CAPTCHA_PROVIDER=turnstile → Cloudflare Turnstile (verify server-side).
 *   - CAPTCHA_PROVIDER=fake (o ausente fuera de producción) → adaptador falso.
 *
 * La OBLIGATORIEDAD la marca CAPTCHA_ENABLED (opt-in). Si el control es
 * obligatorio en producción y falta la configuración de Turnstile, la app falla
 * al arrancar (env.validation), que es el comportamiento fail-closed deseado.
 * El adaptador falso NUNCA se selecciona en producción.
 */
@Global()
@Module({
  providers: [
    FakeCaptchaProvider,
    TurnstileCaptchaProvider,
    {
      provide: CAPTCHA_PROVIDER,
      inject: [ConfigService, FakeCaptchaProvider, TurnstileCaptchaProvider],
      useFactory: (
        config: ConfigService,
        fake: FakeCaptchaProvider,
        turnstile: TurnstileCaptchaProvider,
      ): CaptchaProvider => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        const name = config.get<string>('CAPTCHA_PROVIDER')?.trim();
        // En producción el proveedor real es obligatorio; el falso queda vetado.
        if (name === 'turnstile' || isProduction) return turnstile;
        return fake;
      },
    },
    CaptchaService,
    CaptchaGuard,
  ],
  exports: [CaptchaService, CaptchaGuard],
})
export class CaptchaModule {}
