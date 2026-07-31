import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CookieOriginGuard } from './cookie-origin.guard';

function ctx(origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: origin ? { origin } : {} }),
    }),
  } as unknown as ExecutionContext;
}

function guardWith(
  config: Record<string, string | undefined>,
): CookieOriginGuard {
  return new CookieOriginGuard({
    get: (key: string) => config[key],
  } as any);
}

describe('CookieOriginGuard', () => {
  it('allows a request whose Origin matches FRONTEND_URL', () => {
    const guard = guardWith({
      FRONTEND_URL: 'https://crm-staging.tehusrattan.com',
      NODE_ENV: 'production',
    });
    expect(guard.canActivate(ctx('https://crm-staging.tehusrattan.com'))).toBe(
      true,
    );
  });

  it('rejects a request from an arbitrary/foreign Origin with 403', () => {
    const guard = guardWith({
      FRONTEND_URL: 'https://crm-staging.tehusrattan.com',
      NODE_ENV: 'production',
    });
    expect(() => guard.canActivate(ctx('https://evil.example.com'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects the literal Origin "null" (opaque/sandboxed origin) with 403', () => {
    const guard = guardWith({
      FRONTEND_URL: 'https://crm-staging.tehusrattan.com',
      NODE_ENV: 'production',
    });
    expect(() => guard.canActivate(ctx('null'))).toThrow(ForbiddenException);
  });

  it('allows a missing Origin in non-production (curl / supertest)', () => {
    const guard = guardWith({
      FRONTEND_URL: 'https://crm.example.com',
      NODE_ENV: 'development',
    });
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('fails closed on a missing Origin in production (browser endpoints always send Origin)', () => {
    const guard = guardWith({
      FRONTEND_URL: 'https://crm.example.com',
      NODE_ENV: 'production',
    });
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('fails closed in production when no allowed origins are configured (no FRONTEND_URL)', () => {
    const guard = guardWith({ NODE_ENV: 'production' });
    expect(() => guard.canActivate(ctx('https://crm.example.com'))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('allows http://localhost:3000 in non-production only', () => {
    const dev = guardWith({ NODE_ENV: 'development' });
    expect(dev.canActivate(ctx('http://localhost:3000'))).toBe(true);

    const prod = guardWith({
      FRONTEND_URL: 'https://crm.example.com',
      NODE_ENV: 'production',
    });
    expect(() => prod.canActivate(ctx('http://localhost:3000'))).toThrow(
      ForbiddenException,
    );
  });

  it('honors an explicit CSRF_ALLOWED_ORIGINS allowlist (comma-separated)', () => {
    const guard = guardWith({
      CSRF_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
      NODE_ENV: 'production',
    });
    expect(guard.canActivate(ctx('https://a.example.com'))).toBe(true);
    expect(guard.canActivate(ctx('https://b.example.com'))).toBe(true);
    expect(() => guard.canActivate(ctx('https://c.example.com'))).toThrow(
      ForbiddenException,
    );
  });
});
