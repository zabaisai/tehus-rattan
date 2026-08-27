import { HttpException } from '@nestjs/common';
import { AccountThrottleGuard } from './account-throttle.guard';

// ThrottlerStorage falso: cuenta en memoria por clave, bloquea al superar el
// límite. Determinista, sin Redis.
function storageFalso() {
  const hits = new Map<string, number>();
  return {
    hits,
    increment: jest.fn(async (key: string, _ttl, limit: number, _bd, _name) => {
      const n = (hits.get(key) ?? 0) + 1;
      hits.set(key, n);
      return {
        totalHits: n,
        timeToExpire: 900,
        isBlocked: n > limit,
        timeToBlockExpire: n > limit ? 900 : 0,
      };
    }),
  };
}

function ctx(path: string, body: Record<string, unknown>) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: path, body }) }),
  } as any;
}

describe('AccountThrottleGuard', () => {
  const OLD_ENV = process.env.NODE_ENV;
  beforeAll(() => {
    // El guard es no-op en test; para ejercitarlo se simula entorno no-test.
    process.env.NODE_ENV = 'development';
  });
  afterAll(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it('es no-op fuera de las rutas sensibles', async () => {
    const st = storageFalso();
    const guard = new AccountThrottleGuard(st);
    expect(
      await guard.canActivate(ctx('/api/contacts', { email: 'a@x.test' })),
    ).toBe(true);
    expect(st.increment).not.toHaveBeenCalled();
  });

  it('es no-op sin email en el body (el límite por IP ya cubre)', async () => {
    const st = storageFalso();
    const guard = new AccountThrottleGuard(st);
    expect(await guard.canActivate(ctx('/api/auth/login', {}))).toBe(true);
    expect(st.increment).not.toHaveBeenCalled();
  });

  it('cuenta por cuenta NORMALIZADA (case + espacios) y bloquea al superar', async () => {
    process.env.THROTTLE_ACCOUNT_LIMIT = '3';
    const st = storageFalso();
    const guard = new AccountThrottleGuard(st);
    const variantes = ['a@x.test', 'A@X.test', '  a@x.test  '];
    // 3 intentos (mismo destino normalizado) pasan.
    for (let i = 0; i < 3; i++) {
      await expect(
        guard.canActivate(ctx('/api/auth/login', { email: variantes[i] })),
      ).resolves.toBe(true);
    }
    // El 4º supera el límite → 429.
    await expect(
      guard.canActivate(ctx('/api/auth/login', { email: 'a@x.test' })),
    ).rejects.toBeInstanceOf(HttpException);
    // Todas las variantes cayeron en la MISMA clave.
    expect(st.hits.size).toBe(1);
    delete process.env.THROTTLE_ACCOUNT_LIMIT;
  });

  it('cuentas distintas no se pisan', async () => {
    const st = storageFalso();
    const guard = new AccountThrottleGuard(st);
    await guard.canActivate(
      ctx('/api/auth/forgot-password', { email: 'a@x.test' }),
    );
    await guard.canActivate(
      ctx('/api/auth/forgot-password', { email: 'b@x.test' }),
    );
    expect(st.hits.size).toBe(2);
  });

  it('el mensaje 429 es genérico (no enumera cuentas)', async () => {
    process.env.THROTTLE_ACCOUNT_LIMIT = '1';
    const st = storageFalso();
    const guard = new AccountThrottleGuard(st);
    await guard.canActivate(ctx('/api/auth/login', { email: 'a@x.test' }));
    try {
      await guard.canActivate(ctx('/api/auth/login', { email: 'a@x.test' }));
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as HttpException).message;
      expect(msg).not.toContain('a@x.test');
      expect(msg).toMatch(/Demasiados intentos/);
    }
    delete process.env.THROTTLE_ACCOUNT_LIMIT;
  });
});
