import { validateEnv, DEFAULT_GRAPH_API_VERSION } from './env.validation';

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
    ).toThrow(/WHATSAPP_APP_SECRET is required when WHATSAPP_WEBHOOK_ENABLED=true/);
    expect(() =>
      validateEnv({ ...base, WHATSAPP_WEBHOOK_ENABLED: 'true', WHATSAPP_APP_SECRET: 's' }),
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

  it('validates the Graph API version format when present', () => {
    expect(() =>
      validateEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: 'v22.0' }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: '19' }),
    ).toThrow(/WHATSAPP_GRAPH_API_VERSION must look like/);
    expect(() =>
      validateEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: 'latest' }),
    ).toThrow(/WHATSAPP_GRAPH_API_VERSION/);
  });

  it('never echoes a secret value in the error message', () => {
    try {
      validateEnv({ ...base, WHATSAPP_WEBHOOK_ENABLED: 'true', WHATSAPP_APP_SECRET: 'super-secret-value' });
    } catch (e) {
      // The only failure here is the missing verify token; the provided secret
      // must not appear in the message.
      expect((e as Error).message).not.toContain('super-secret-value');
    }
  });

  it('exposes a well-formed default Graph API version', () => {
    expect(DEFAULT_GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});
