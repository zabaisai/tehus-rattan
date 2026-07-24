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
const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout", "/onboarding"];

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
const CROSS_TAB_LOCK = 'tehus-auth-refresh';
const LOCK_TIMEOUT_MS = 5000;

// Shared across every concurrent 401 in THIS tab — the first to hit this creates
// the promise and starts one refresh; every other request that 401s while it is
// in flight awaits this SAME promise. Cleared once it settles.
let refreshPromise: Promise<string | null> | null = null;

// One POST /auth/refresh, with a single retry. A 401 can be a *recoverable*
// race: another tab just rotated the shared httpOnly cookie, so the token this
// request sent is already spent. Retrying once uses the now-current cookie and
// succeeds. Two failures in a row mean the session is genuinely gone → null
// (the caller logs out). Never loops beyond one retry, so there is no storm.
async function attemptRefresh(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await axios.post<{ token: string }>(REFRESH_URL, undefined, {
        withCredentials: true,
      });
      setAccessToken(data.token);
      return data.token;
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}

// Serialize refresh ACROSS TABS with the Web Locks API so two tabs never rotate
// the same refresh token at the same instant. Each tab still makes its OWN
// request and keeps its OWN access token in memory — the lock only orders them,
// it never shares a token. Falls back to an unlocked refresh when Web Locks is
// unavailable or acquiring the lock times out (a stuck holder must never block
// refresh forever); the per-request retry above plus the backend compare-and-
// swap keep that fallback race-safe and loop-free.
async function refreshWithCrossTabLock(): Promise<string | null> {
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
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshWithCrossTabLock().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

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

    const newToken = await refreshAccessToken();

    if (!newToken) {
      handleSessionInvalidated();
      return Promise.reject(error);
    }

    originalRequest.headers.Authorization = `Bearer ${newToken}`;
    return api(originalRequest);
  },
);

export default api;
