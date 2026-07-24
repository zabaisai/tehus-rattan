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

  if (!config.JWT_SECRET?.trim()) {
    errors.push('JWT_SECRET is required');
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

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return config;
}
