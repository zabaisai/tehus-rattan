import { createHash } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';

// Límite por IDENTIFICADOR DE CUENTA normalizado, complementario al límite por
// IP del AppThrottlerGuard. Motivo: el límite por IP no frena un ataque
// DISTRIBUIDO (muchas IPs) contra UNA cuenta. Este guard cuenta los intentos por
// email normalizado (minúsculas + trim, luego SHA-256 para no guardar el email
// en claro), de modo que login/recuperación tienen ambos techos a la vez.
//
// Anti-enumeración: si se supera, responde 429 con un mensaje GENÉRICO idéntico
// para cualquier cuenta; nunca revela si el email existe.
//
// Usa el MISMO ThrottlerStorage que el resto (Redis con fallback local), así que
// hereda el comportamiento fail-safe: una caída de Redis degrada a límite local,
// nunca a ilimitado.
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const BLOCK_MS = 15 * 60 * 1000;

function positiveIntFromEnv(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

@Injectable()
export class AccountThrottleGuard implements CanActivate {
  constructor(
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {}

  private limit(): number {
    // Conservador por defecto: 10 intentos por cuenta cada 15 min.
    return positiveIntFromEnv(process.env.THROTTLE_ACCOUNT_LIMIT, 10);
  }

  // Solo actúa en las rutas sensibles que reciben un email en el body. Se
  // registra como APP_GUARD (donde ThrottlerStorage es resoluble) pero es un
  // no-op para el resto de rutas, igual que AppThrottlerGuard filtra por path.
  private static readonly RUTAS_SENSIBLES = [
    '/auth/login',
    '/auth/forgot-password',
    '/auth/reset-password',
  ];

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    // ACTIVO en todos los entornos (incl. producción y pruebas): el control no
    // se apaga por NODE_ENV. Las e2e que NO ejercitan rate limiting y hacen
    // muchos logins con la misma cuenta lo desactivan con un override EXPLÍCITO
    // (.overrideGuard(AccountThrottleGuard)); la e2e dedicada lo deja activo.
    const req = context.switchToHttp().getRequest<Request>();
    const path: string = req.originalUrl ?? req.url ?? '';
    if (!AccountThrottleGuard.RUTAS_SENSIBLES.some((r) => path.includes(r))) {
      return true;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = body.email;
    if (typeof raw !== 'string' || !raw.trim()) {
      // Sin identificador de cuenta no aplica; el límite por IP ya cubre.
      return true;
    }

    const normalized = raw.trim().toLowerCase();
    const key = `acct:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;

    const record = await this.storage.increment(
      key,
      WINDOW_MS,
      this.limit(),
      BLOCK_MS,
      'account',
    );

    if (record.isBlocked || record.totalHits > this.limit()) {
      // Mensaje genérico: no distingue cuenta existente de inexistente.
      throw new HttpException(
        'Demasiados intentos. Inténtalo de nuevo más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
