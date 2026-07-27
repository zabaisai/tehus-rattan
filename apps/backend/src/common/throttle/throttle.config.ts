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
  // Always per-IP (see AppThrottlerGuard) — device bucketing is deliberately
  // NOT applied here so it cannot dilute brute-force protection.
  auth: positiveIntFromEnv('THROTTLE_AUTH_LIMIT', 10),
  // Refresh is bucketed PER DEVICE (via the httpOnly device-id cookie), not per
  // shared IP — see AppThrottlerGuard — so colleagues behind one office
  // NAT/public IP never exhaust each other's refresh budget. 30/minute is very
  // generous for one honest device (a 15-min access token needs ~4 refreshes/h
  // plus the odd reload) while still capping a runaway loop; the whole office is
  // effectively N_devices × this limit. Clients that send no device-id cookie
  // fall back to a per-IP bucket at this same limit.
  refresh: positiveIntFromEnv('THROTTLE_REFRESH_LIMIT', 30),
  // Onboarding + legacy register: throttle invite-code guessing.
  onboarding: positiveIntFromEnv('THROTTLE_ONBOARDING_LIMIT', 15),
  // Password recovery (forgot/reset): strict, PER-IP (a credential-sensitive
  // endpoint — deliberately not device-bucketed). Per-account abuse is
  // additionally bounded by a resend cooldown in PasswordResetTokenService.
  passwordReset: positiveIntFromEnv('THROTTLE_PASSWORD_RESET_LIMIT', 5),
  // Webhook POST: high enough to absorb legitimate Meta bursts.
  webhook: positiveIntFromEnv('THROTTLE_WEBHOOK_LIMIT', 600),
  // Webhook GET verify handshake: modest.
  webhookVerify: positiveIntFromEnv('THROTTLE_WEBHOOK_VERIFY_LIMIT', 30),
} as const;
