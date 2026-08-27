// Centralized environment validation run by ConfigModule at startup. Fails
// fast with a clear message when a REQUIRED variable for an ENABLED feature is
// missing, but never forces WhatsApp config on environments that don't use it.
// Never prints any secret value.

type Env = Record<string, string | undefined>;

// The only accepted shape for WHATSAPP_GRAPH_API_VERSION: v<major>.<minor>.
// There is intentionally NO default version baked into the code — the operator
// must set a version they have verified as supported in Meta's official docs.
export const GRAPH_API_VERSION_FORMAT = /^v\d+\.\d+$/;

export function validateEnv(config: Env): Env {
  const errors: string[] = [];
  const isProduction = config.NODE_ENV?.trim() === 'production';

  const jwtSecret = config.JWT_SECRET?.trim();
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (isProduction && jwtSecret.length < 32) {
    // In production a short symmetric secret is brute-forceable; require at
    // least 32 chars (e.g. `openssl rand -base64 32`). Dev/test keep short
    // fixtures working.
    errors.push('JWT_SECRET must be at least 32 characters in production');
  }

  // DATABASE_URL is consumed only by the generated Prisma client, so a missing
  // or malformed value otherwise fails lazily at first query. It is required in
  // production; its shape is validated whenever present (dev/test may inject it
  // through other means). Never print the value.
  const databaseUrl = config.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (isProduction) errors.push('DATABASE_URL is required in production');
  } else if (!/^postgres(ql)?:\/\/.+/i.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgres(ql):// connection string');
  }

  // The WhatsApp access-token encryption key decrypts per-company tokens.
  // Without it the crypto service throws lazily on first encrypt/decrypt.
  // Required in production, with a minimum length so a trivially short key
  // never protects real tokens; dev/test keep short fixtures working.
  const encryptionKey = config.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    if (isProduction) {
      errors.push('WHATSAPP_TOKEN_ENCRYPTION_KEY is required in production');
    }
  } else if (isProduction && encryptionKey.length < 32) {
    errors.push(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY must be at least 32 characters in production',
    );
  }

  // Opt-in flag: only when the webhook is explicitly enabled do we demand the
  // secrets it needs. The WhatsAppSignatureGuard is fail-closed regardless, so
  // an environment that never enables the webhook still rejects unsigned POSTs.
  const webhookEnabled = config.WHATSAPP_WEBHOOK_ENABLED?.trim() === 'true';
  if (webhookEnabled) {
    if (!config.WHATSAPP_APP_SECRET?.trim()) {
      errors.push(
        'WHATSAPP_APP_SECRET is required when WHATSAPP_WEBHOOK_ENABLED=true',
      );
    }
    if (!config.WHATSAPP_VERIFY_TOKEN?.trim()) {
      errors.push(
        'WHATSAPP_VERIFY_TOKEN is required when WHATSAPP_WEBHOOK_ENABLED=true',
      );
    }
  }

  const graphVersion = config.WHATSAPP_GRAPH_API_VERSION?.trim();
  if (graphVersion && !GRAPH_API_VERSION_FORMAT.test(graphVersion)) {
    errors.push(
      'WHATSAPP_GRAPH_API_VERSION must be in the form v<major>.<minor>',
    );
  }

  // Opt-in flag for Meta Embedded Signup. When enabled, the server-side code
  // exchange + Graph calls need the app id, the Embedded Signup configuration
  // id, the app secret, and a valid Graph API version. The app secret is
  // shared with the webhook signature guard. When disabled (default in
  // dev/tests), the embedded-signup endpoints return a controlled 503.
  const embeddedSignupEnabled =
    config.WHATSAPP_EMBEDDED_SIGNUP_ENABLED?.trim() === 'true';
  if (embeddedSignupEnabled) {
    for (const key of [
      'WHATSAPP_APP_ID',
      'WHATSAPP_CONFIG_ID',
      'WHATSAPP_APP_SECRET',
    ]) {
      if (!config[key]?.trim()) {
        errors.push(
          `${key} is required when WHATSAPP_EMBEDDED_SIGNUP_ENABLED=true`,
        );
      }
    }
    if (!graphVersion) {
      errors.push(
        'WHATSAPP_GRAPH_API_VERSION is required when WHATSAPP_EMBEDDED_SIGNUP_ENABLED=true',
      );
    }
  }

  const signupTtl = config.WHATSAPP_EMBEDDED_SIGNUP_STATE_TTL_MINUTES?.trim();
  if (
    signupTtl &&
    !(Number.isInteger(Number(signupTtl)) && Number(signupTtl) > 0)
  ) {
    errors.push(
      'WHATSAPP_EMBEDDED_SIGNUP_STATE_TTL_MINUTES must be a positive integer',
    );
  }

  // Opt-in flag for transactional email (password recovery). When enabled, the
  // SMTP settings the MailService needs are required; when disabled (default in
  // dev/tests), the recovery endpoints still work — email is a controlled no-op.
  const passwordResetEnabled = config.PASSWORD_RESET_ENABLED?.trim() === 'true';
  if (passwordResetEnabled) {
    for (const key of [
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'SMTP_FROM_EMAIL',
    ]) {
      if (!config[key]?.trim()) {
        errors.push(`${key} is required when PASSWORD_RESET_ENABLED=true`);
      }
    }
    if (!config.PASSWORD_RESET_URL?.trim()) {
      errors.push(
        'PASSWORD_RESET_URL is required when PASSWORD_RESET_ENABLED=true',
      );
    }
  }

  // Format-check the reset URL whenever it is set (must be an absolute http(s)
  // URL — the emailed link is only ever built from this, never a client value).
  const resetUrl = config.PASSWORD_RESET_URL?.trim();
  if (resetUrl && !/^https?:\/\/.+/i.test(resetUrl)) {
    errors.push('PASSWORD_RESET_URL must be an absolute http(s) URL');
  }

  const ttl = config.PASSWORD_RESET_TOKEN_TTL_MINUTES?.trim();
  if (ttl && !(Number.isInteger(Number(ttl)) && Number(ttl) > 0)) {
    errors.push('PASSWORD_RESET_TOKEN_TTL_MINUTES must be a positive integer');
  }

  // Antibot (Cloudflare Turnstile). Opt-in vía CAPTCHA_ENABLED. Cuando el
  // control es obligatorio (enabled) con el proveedor real, el secret es
  // imprescindible: sin él no se puede verificar y el guard bloquearía todo.
  // Fail-closed: en producción con captcha activo y Turnstile, exige el secret.
  const captchaEnabled = config.CAPTCHA_ENABLED?.trim() === 'true';
  const captchaProvider = config.CAPTCHA_PROVIDER?.trim();
  const usaTurnstile = captchaProvider === 'turnstile' || isProduction;
  if (captchaEnabled && usaTurnstile && !config.TURNSTILE_SECRET_KEY?.trim()) {
    errors.push(
      'TURNSTILE_SECRET_KEY is required when CAPTCHA_ENABLED=true with the turnstile provider',
    );
  }
  if (
    captchaEnabled &&
    isProduction &&
    captchaProvider &&
    captchaProvider !== 'turnstile'
  ) {
    // El adaptador falso jamás debe ser el control real en producción.
    errors.push(
      'CAPTCHA_PROVIDER must be "turnstile" in production when CAPTCHA_ENABLED=true',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n- ${errors.join('\n- ')}`,
    );
  }

  return config;
}
