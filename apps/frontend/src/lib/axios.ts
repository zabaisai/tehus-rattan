import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/auth.store";
import { getAccessToken, setAccessToken } from "@/lib/auth-token";
import { broadcastAuthEvent } from "@/lib/auth-events";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Needed so the httpOnly device-id/refresh-token cookies set by the backend
  // (see apps/backend/src/modules/sessions) travel on requests. The access JWT
  // itself is NOT a cookie — it travels only as an Authorization: Bearer header
  // and lives only in tab memory (lib/auth-token.ts).
  withCredentials: true,
});

// Attach the in-memory access token. Never reads localStorage/cookies.
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Requests to these never trigger a silent refresh on 401 — a failed login is
// a real credentials error (not an expired access token), a failed refresh must
// not try to refresh itself, and onboarding is a public pre-auth flow.
const NO_REFRESH_PATHS = [
  "/auth/login",
  // La verificacion de dispositivo ocurre ANTES de que exista sesion: un 401
  // aqui es «el codigo no vale», nunca «el token caduco». Sin esta entrada el
  // interceptor intentaria refrescar una sesion que todavia no existe, y el
  // error real llegaria tarde o convertido en un cierre de sesion.
  "/auth/verify-device",
  "/auth/verify-device/resend",
  "/auth/refresh",
  "/auth/logout",
  "/onboarding",
  "/auth/forgot-password",
  "/auth/reset-password",
];

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return true;
  return NO_REFRESH_PATHS.some((path) => url.includes(path));
}

let redirected = false;
function handleSessionInvalidated() {
  if (typeof window === "undefined") return;
  useAuthStore.getState().clearSession();
  // Tell other tabs their session is gone too.
  broadcastAuthEvent("session-invalidated");
  // Redirect at most once, and never away from the login page itself.
  if (!redirected && window.location.pathname !== "/login") {
    redirected = true;
    window.location.href = "/login";
  }
}

const REFRESH_URL = `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`;
// Nombre canónico TAKTO. No hay fallback: dos pestañas con bundles distintos
// solo coexisten durante el despliegue, y el backend serializa la rotación
// por compare-and-swap de todas formas.
const CROSS_TAB_LOCK = 'takto-auth-refresh';
const LOCK_TIMEOUT_MS = 5000;

// A refresh attempt has four genuinely different outcomes. Collapsing them all
// into `string | null` (as before) made a transient 429 / network blip / 5xx
// indistinguishable from a truly invalid session, so any two consecutive
// failures logged the user out globally. Callers must branch on the outcome:
//  - success:            a new access token was minted.
//  - invalid-session:    two consecutive 401s → the refresh token is really
//                        gone/revoked. ONLY this should clear the session.
//  - transient-error:    429 / network / timeout / 5xx → the session may well be
//                        alive; keep it, surface a recoverable failure.
//  - configuration-error: 403 (Origin/CSRF/config) → do not log out, do not storm.
export type RefreshResult =
  | { status: 'success'; token: string }
  | { status: 'invalid-session' }
  | { status: 'transient-error'; retryAfterMs?: number }
  | { status: 'configuration-error' };

export type RefreshErrorKind = 'invalid' | 'transient' | 'configuration';

// Map an Axios failure onto a coarse kind. A missing response object means the
// request never got an HTTP status (DNS failure, connection refused, timeout,
// CORS/network) → transient. Any unexpected 4xx that is neither 401 nor 403 is
// treated as transient too: it must never force a false logout, and returning
// transient keeps the session and avoids a retry storm.
export function classifyRefreshError(error: unknown): RefreshErrorKind {
  const status = (error as AxiosError | undefined)?.response?.status;
  if (status === undefined) return 'transient'; // network error / timeout
  if (status === 401) return 'invalid';
  if (status === 403) return 'configuration';
  if (status === 429) return 'transient';
  if (status >= 500) return 'transient';
  return 'transient';
}

// Best-effort parse of a Retry-After header (delta-seconds or HTTP-date). Only
// used to annotate a transient result; we never auto-retry a 429, so this is
// informational (e.g. for a future backoff), not a scheduler.
function parseRetryAfterMs(error: unknown): number | undefined {
  const header = (error as AxiosError | undefined)?.response?.headers?.[
    'retry-after'
  ];
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(String(header));
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

async function postRefresh(): Promise<{ token: string }> {
  const { data } = await axios.post<{ token: string }>(REFRESH_URL, undefined, {
    withCredentials: true,
  });
  return data;
}

// One POST /auth/refresh, with a SINGLE retry that is used ONLY for a first 401
// (a recoverable CAS race: another tab just rotated the shared httpOnly cookie,
// so the token this request sent is already spent — retrying uses the now-current
// cookie). A 429 / 5xx / network / 403 on the first attempt returns immediately:
// there is no second immediate attempt, so we never worsen a rate limit and
// never storm. Two 401s in a row are a genuinely invalid session.
async function attemptRefresh(): Promise<RefreshResult> {
  try {
    const { token } = await postRefresh();
    setAccessToken(token);
    return { status: 'success', token };
  } catch (error) {
    const kind = classifyRefreshError(error);
    if (kind === 'configuration') return { status: 'configuration-error' };
    if (kind === 'transient') {
      return { status: 'transient-error', retryAfterMs: parseRetryAfterMs(error) };
    }
    // kind === 'invalid' (first 401) → fall through to exactly one retry.
  }

  try {
    const { token } = await postRefresh();
    setAccessToken(token);
    return { status: 'success', token };
  } catch (error) {
    const kind = classifyRefreshError(error);
    if (kind === 'invalid') return { status: 'invalid-session' };
    if (kind === 'configuration') return { status: 'configuration-error' };
    return { status: 'transient-error', retryAfterMs: parseRetryAfterMs(error) };
  }
}

// Shared across every concurrent 401 in THIS tab — the first to hit this creates
// the promise and starts one refresh; every other request that 401s while it is
// in flight awaits this SAME promise. Cleared once it settles.
let refreshPromise: Promise<RefreshResult> | null = null;

// Serialize refresh ACROSS TABS with the Web Locks API so two tabs never rotate
// the same refresh token at the same instant. Each tab still makes its OWN
// request and keeps its OWN access token in memory — the lock only orders them,
// it never shares a token. Falls back to an unlocked refresh when Web Locks is
// unavailable or acquiring the lock times out (a stuck holder must never block
// refresh forever); the per-request retry above plus the backend compare-and-
// swap keep that fallback race-safe and loop-free.
async function refreshWithCrossTabLock(): Promise<RefreshResult> {
  const locks =
    typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    return attemptRefresh();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCK_TIMEOUT_MS);
  try {
    return await locks.request(
      CROSS_TAB_LOCK,
      { mode: 'exclusive', signal: controller.signal },
      () => attemptRefresh(),
    );
  } catch {
    // Lock acquisition aborted (timeout) or unsupported options → unlocked.
    return attemptRefresh();
  } finally {
    clearTimeout(timer);
  }
}

// Exposed so the bootstrap flow reuses the exact same single-flight refresh.
export function refreshAccessToken(): Promise<RefreshResult> {
  if (!refreshPromise) {
    refreshPromise = refreshWithCrossTabLock().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

let configErrorLogged = false;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      shouldSkipRefresh(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    // Retry this exact request at most once — if the retried attempt also 401s
    // (session genuinely gone) it falls through above instead of looping.
    originalRequest._retry = true;

    const result = await refreshAccessToken();

    if (result.status === 'success') {
      originalRequest.headers.Authorization = `Bearer ${result.token}`;
      return api(originalRequest);
    }

    // ONLY a genuinely invalid session clears memory / broadcasts / redirects.
    if (result.status === 'invalid-session') {
      handleSessionInvalidated();
    } else if (result.status === 'configuration-error' && !configErrorLogged) {
      // Surface once for diagnosis; never log out, never storm.
      configErrorLogged = true;
      console.error(
        'Refresh rejected with a configuration/security error (403). ' +
          'Session kept; check Origin/CORS configuration.',
      );
    }
    // transient-error / configuration-error: keep the session, surface the
    // original failure to the caller so it can retry later. No logout.
    return Promise.reject(error);
  },
);

export default api;
