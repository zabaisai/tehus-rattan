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

// Shared across every concurrent 401 in this tab — the first to hit this creates
// the promise and starts the real POST /auth/refresh; every other request that
// 401s while it is in flight awaits this SAME promise instead of firing its own
// refresh (which would each rotate the one-use refresh token and race). Cleared
// once the attempt settles, so the next 401 after that starts a fresh one.
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ token: string }>(
      `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
      undefined,
      { withCredentials: true },
    );
    setAccessToken(data.token);
    return data.token;
  } catch {
    return null;
  }
}

// Exposed so the bootstrap flow reuses the exact same single-flight refresh.
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
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
