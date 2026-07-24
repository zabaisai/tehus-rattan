// Rate-limiting limits, configurable per environment. Values are read from
// process.env at import time (real deployments set them as container/OS env
// vars, so they are present here); when unset — including local .env-only
// setups — the documented staging defaults apply. Decorators are static, so
// these must be plain constants, not injected config.
//
// THROTTLE_TTL is the window in milliseconds (@nestjs/throttler uses ms).

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const THROTTLE_TTL_MS = positiveIntFromEnv('THROTTLE_TTL', 60_000);

// Per-endpoint request ceilings within one THROTTLE_TTL_MS window.
export const THROTTLE_LIMITS = {
  // Generous global default so normal authenticated traffic is never
  // accidentally rate-limited.
  default: positiveIntFromEnv('THROTTLE_DEFAULT_LIMIT', 300),
  // Strict on the credential endpoint (brute-force / credential stuffing).
  auth: positiveIntFromEnv('THROTTLE_AUTH_LIMIT', 10),
  // Refresh is called more often than login but still bounded.
  refresh: positiveIntFromEnv('THROTTLE_REFRESH_LIMIT', 30),
  // Onboarding + legacy register: throttle invite-code guessing.
  onboarding: positiveIntFromEnv('THROTTLE_ONBOARDING_LIMIT', 15),
  // Webhook POST: high enough to absorb legitimate Meta bursts.
  webhook: positiveIntFromEnv('THROTTLE_WEBHOOK_LIMIT', 600),
  // Webhook GET verify handshake: modest.
  webhookVerify: positiveIntFromEnv('THROTTLE_WEBHOOK_VERIFY_LIMIT', 30),
} as const;
