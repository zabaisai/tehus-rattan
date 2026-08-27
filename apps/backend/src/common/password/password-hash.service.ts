import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

// Coste bcrypt objetivo. Configurable por BCRYPT_COST; por defecto 12 (mínimo
// razonable para 2026). En producción, env.validation exige >= 12.
export const DEFAULT_BCRYPT_COST = 12;

function targetCost(): number {
  const raw = Number(process.env.BCRYPT_COST);
  if (Number.isInteger(raw) && raw >= 4 && raw <= 20) return raw;
  return DEFAULT_BCRYPT_COST;
}

/**
 * Hashing de contraseñas centralizado, con REHASH PROGRESIVO.
 *
 * - Cifra siempre con el coste objetivo actual.
 * - `necesitaRehash(hash)` detecta hashes con coste inferior al objetivo (los
 *   `$2a$10$...` heredados) leyendo el coste del propio hash.
 * - Tras un login válido, si el hash es más débil que el objetivo se recifra la
 *   MISMA contraseña con el coste nuevo y se guarda. Sin cierres masivos: cada
 *   usuario se actualiza solo, la próxima vez que entra.
 *
 * Nunca registra la contraseña ni el hash.
 */
@Injectable()
export class PasswordHashService {
  private readonly logger = new Logger(PasswordHashService.name);

  get cost(): number {
    return targetCost();
  }

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  async compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** ¿El hash usa un coste inferior al objetivo actual? */
  necesitaRehash(hash: string): boolean {
    try {
      return bcrypt.getRounds(hash) < this.cost;
    } catch {
      // Un hash ilegible no se toca aquí; el flujo de login ya falla la compare.
      return false;
    }
  }

  /**
   * Si el hash es más débil que el objetivo, recifra la contraseña y ejecuta
   * `persistir(nuevoHash)`. Best-effort: un fallo al persistir NUNCA rompe el
   * login (se registra y se sigue). Devuelve true si recifró.
   */
  async rehashSiHaceFalta(
    plain: string,
    hashActual: string,
    persistir: (nuevoHash: string) => Promise<void>,
  ): Promise<boolean> {
    if (!this.necesitaRehash(hashActual)) return false;
    try {
      const nuevo = await this.hash(plain);
      await persistir(nuevo);
      return true;
    } catch {
      // El rehash es una mejora oportunista: si falla, el usuario sigue dentro.
      this.logger.warn('Rehash progresivo de contraseña no persistido');
      return false;
    }
  }
}
