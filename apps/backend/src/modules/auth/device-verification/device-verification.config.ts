import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Configuración de la verificación de dispositivo.
 *
 * El servidor es la autoridad: el navegador no puede pedir que se salte la
 * verificación ni que se aplique. Todo se decide aquí, con variables de
 * entorno del servidor.
 *
 *  - `AUTH_DEVICE_VERIFICATION_ENABLED`: interruptor general. Apagado por
 *    defecto, para que desplegar el código no cambie el inicio de sesión de
 *    nadie.
 *  - `AUTH_DEVICE_VERIFICATION_ALLOWLIST`: despliegue controlado. Lista de
 *    correos separados por coma; si trae algo, la verificación solo se exige a
 *    esas cuentas. Sirve para probar en staging con una cuenta de QA sin
 *    afectar al resto. Vive en la configuración protegida del servidor, nunca
 *    en el repositorio, y no se registra.
 *  - `AUTH_CHALLENGE_HMAC_SECRET`: secreto exclusivo del digest del código. No
 *    se reutiliza `JWT_SECRET` ni ningún otro: si un secreto se rota o se
 *    filtra, el radio de daño no debe extenderse a otra función.
 */
@Injectable()
export class DeviceVerificationConfig {
  private readonly logger = new Logger(DeviceVerificationConfig.name);
  private avisoDeSecreto = false;

  constructor(private readonly config: ConfigService) {}

  /** Interruptor general, tal como está en el entorno. */
  get featureEnabled(): boolean {
    return (
      this.config.get<string>('AUTH_DEVICE_VERIFICATION_ENABLED') === 'true'
    );
  }

  /** Secreto del HMAC, o `null` si no está configurado. */
  get hmacSecret(): string | null {
    const raw = this.config.get<string>('AUTH_CHALLENGE_HMAC_SECRET')?.trim();
    return raw ? raw : null;
  }

  /** Correos normalizados a los que se limita el despliegue; vacío = a todos. */
  get allowlist(): string[] {
    const raw = this.config.get<string>('AUTH_DEVICE_VERIFICATION_ALLOWLIST');
    if (!raw) return [];
    return raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * ¿Hay que verificar el dispositivo de esta cuenta?
   *
   * Exige interruptor encendido, secreto presente y —si hay allowlist— que la
   * cuenta esté en ella. Sin secreto no se activa: preferimos el inicio de
   * sesión de siempre antes que un reto cuyo digest no se puede calcular.
   */
  appliesTo(email: string): boolean {
    if (!this.featureEnabled) return false;
    if (!this.hmacSecret) {
      if (!this.avisoDeSecreto) {
        this.avisoDeSecreto = true;
        this.logger.error(
          'AUTH_DEVICE_VERIFICATION_ENABLED está activo pero falta AUTH_CHALLENGE_HMAC_SECRET: la verificación de dispositivo queda inactiva',
        );
      }
      return false;
    }
    const lista = this.allowlist;
    if (lista.length === 0) return true;
    return lista.includes(email.trim().toLowerCase());
  }
}
