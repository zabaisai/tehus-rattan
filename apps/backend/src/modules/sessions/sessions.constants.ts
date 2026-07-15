export const DEVICE_ID_COOKIE = 'tehus_device_id';
export const REFRESH_TOKEN_COOKIE = 'tehus_refresh_token';

// A session/device cookie that survives long enough to keep recognizing a
// returning browser, but isn't effectively "forever".
export const DEVICE_ID_COOKIE_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000; // ~2 years

// A session with no refresh/activity for this long is lazily flipped to
// EXPIRED the next time it's looked at (mirrors InvitationCodesService's
// expireOverdue() lazy-sweep pattern) — the refresh-token cookie itself
// carries the same max age so the browser stops presenting it around the
// same time the server would reject it anyway.
export const SESSION_INACTIVITY_EXPIRY_DAYS = 90;
export const SESSION_INACTIVITY_EXPIRY_MS = SESSION_INACTIVITY_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// lastActivityAt is throttled to at most one DB write per session in this
// window — see ActivityThrottleInterceptor.
export const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

// Retention defaults (see SessionCleanupService). Must be reflected in the
// privacy policy before this ships to production.
export const LOGIN_EVENT_RETENTION_DAYS = 180;
export const CLOSED_SESSION_RETENTION_DAYS = 180;
