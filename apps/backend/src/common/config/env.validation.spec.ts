import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = { JWT_SECRET: 'x'.repeat(32) };

  it('accepts a minimal valid config (JWT only, webhook disabled)', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it('requires JWT_SECRET', () => {
    expect(() => validateEnv({})).toThrow(/JWT_SECRET is required/);
    expect(() => validateEnv({ JWT_SECRET: '   ' })).toThrow(/JWT_SECRET/);
  });

  it('requires the webhook secrets only when the webhook is enabled', () => {
    // Disabled → no WhatsApp vars required.
    expect(() =>
      validateEnv({ ...base, WHATSAPP_WEBHOOK_ENABLED: 'false' }),
    ).not.toThrow();

    // Enabled but missing both → clear errors for each.
    expect(() =>
      validateEnv({ ...base, WHATSAPP_WEBHOOK_ENABLED: 'true' }),
    ).toThrow(
      /WHATSAPP_APP_SECRET is required when WHATSAPP_WEBHOOK_ENABLED=true/,
    );
    expect(() =>
      validateEnv({
        ...base,
        WHATSAPP_WEBHOOK_ENABLED: 'true',
        WHATSAPP_APP_SECRET: 's',
      }),
    ).toThrow(/WHATSAPP_VERIFY_TOKEN is required/);

    // Enabled and fully configured → ok.
    expect(() =>
      validateEnv({
        ...base,
        WHATSAPP_WEBHOOK_ENABLED: 'true',
        WHATSAPP_APP_SECRET: 'fake-secret',
        WHATSAPP_VERIFY_TOKEN: 'fake-verify',
      }),
    ).not.toThrow();
  });

  it('enforces production-only requirements (JWT length, DATABASE_URL, encryption key)', () => {
    const prod = { NODE_ENV: 'production' };

    // Short JWT secret is fine outside production, rejected in production.
    expect(() => validateEnv({ JWT_SECRET: 'short' })).not.toThrow();
    expect(() => validateEnv({ ...prod, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET must be at least 32 characters/,
    );

    // A fully valid production config passes.
    expect(() =>
      validateEnv({
        ...prod,
        JWT_SECRET: 'x'.repeat(32),
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
        WHATSAPP_TOKEN_ENCRYPTION_KEY: 'y'.repeat(32),
      }),
    ).not.toThrow();

    // Missing DATABASE_URL / encryption key in production are reported.
    expect(() => validateEnv({ ...prod, JWT_SECRET: 'x'.repeat(32) })).toThrow(
      /DATABASE_URL is required in production/,
    );
    expect(() =>
      validateEnv({
        ...prod,
        JWT_SECRET: 'x'.repeat(32),
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
      }),
    ).toThrow(/WHATSAPP_TOKEN_ENCRYPTION_KEY is required in production/);
  });

  it('rejects a malformed DATABASE_URL whenever present', () => {
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'mysql://u:p@db/app' }),
    ).toThrow(/DATABASE_URL must be a postgres/);
  });

  it('requires TURNSTILE_SECRET_KEY when captcha is enabled with turnstile', () => {
    // Provider explícito turnstile, captcha activo, sin secret → error.
    expect(() =>
      validateEnv({
        ...base,
        CAPTCHA_ENABLED: 'true',
        CAPTCHA_PROVIDER: 'turnstile',
      }),
    ).toThrow(/TURNSTILE_SECRET_KEY is required/);

    // Con secret → ok.
    expect(() =>
      validateEnv({
        ...base,
        CAPTCHA_ENABLED: 'true',
        CAPTCHA_PROVIDER: 'turnstile',
        TURNSTILE_SECRET_KEY: 'fake-secret',
      }),
    ).not.toThrow();

    // Desactivado → no exige nada.
    expect(() =>
      validateEnv({ ...base, CAPTCHA_ENABLED: 'false' }),
    ).not.toThrow();

    // En producción el proveedor debe ser turnstile cuando está activo.
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
        WHATSAPP_TOKEN_ENCRYPTION_KEY: 'y'.repeat(32),
        CAPTCHA_ENABLED: 'true',
        CAPTCHA_PROVIDER: 'fake',
        TURNSTILE_SECRET_KEY: 'fake-secret',
      }),
    ).toThrow(/CAPTCHA_PROVIDER must be "turnstile" in production/);
  });

  it('validates the Graph API version format when present', () => {
    expect(() =>
      validateEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: 'v22.0' }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: '19' }),
    ).toThrow(/WHATSAPP_GRAPH_API_VERSION must be in the form/);
    expect(() =>
      validateEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: 'latest' }),
    ).toThrow(/WHATSAPP_GRAPH_API_VERSION/);
  });

  it('never echoes a secret value in the error message', () => {
    try {
      validateEnv({
        ...base,
        WHATSAPP_WEBHOOK_ENABLED: 'true',
        WHATSAPP_APP_SECRET: 'super-secret-value',
      });
    } catch (e) {
      // The only failure here is the missing verify token; the provided secret
      // must not appear in the message.
      expect((e as Error).message).not.toContain('super-secret-value');
    }
  });
});
