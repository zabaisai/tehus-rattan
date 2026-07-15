import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/auth.store";
import { User } from "@/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Needed so the httpOnly device-id/refresh-token cookies set by the
  // backend (see apps/backend/src/modules/sessions) actually travel on
  // cross-origin requests (frontend and backend are different
  // subdomains in staging). Auth itself is unaffected — the JWT still
  // travels only as an Authorization: Bearer header, never a cookie.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Requests to these never trigger a silent refresh on 401 — a failed login
// is a real credentials error (not an expired access token), a failed
// refresh must not try to refresh itself, and onboarding is a public,
// pre-authentication flow.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout", "/onboarding"];

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return true;
  return NO_REFRESH_PATHS.some((path) => url.includes(path));
}

function clearSessionAndRedirect() {
  if (typeof window === "undefined") return;
  useAuthStore.getState().clearSession();
  window.location.href = "/login";
}

// Shared across every concurrent 401 — the first one to hit this creates
// the promise and starts the real POST /auth/refresh; every other request
// that 401s while it's in flight awaits this SAME promise instead of
// firing its own refresh (which would each rotate the one-use refresh
// token and race each other). Cleared once the attempt settles, so the
// next 401 after that starts a fresh one.
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  try {
    const { data } = await axios.post<{
      token: string;
      user: { id: string; email: string; name: string };
    }>(`${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`, undefined, {
      withCredentials: true,
    });

    // Reuses the existing auth store mechanism, but deliberately keeps
    // whatever full user (with role/companyId) is already in the store
    // rather than the refresh response's user — that response only ever
    // carries {id, email, name} (see AuthService.issueSession), and
    // overwriting a real role/companyId with undefined would silently
    // break every role-gated check in the app until the next full reload.
    // The fallback (no user in the store yet) is provisional — the next
    // guarded page load already re-fetches /auth/me regardless.
    const currentUser = useAuthStore.getState().user;
    useAuthStore.getState().setSession(currentUser ?? (data.user as User), data.token);

    return data.token;
  } catch {
    return null;
  }
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

    // Ensures this exact request is retried at most once, even if the
    // retried attempt also comes back 401 (session genuinely gone) — it
    // will fall through to the branch above instead of looping.
    originalRequest._retry = true;

    if (!refreshPromise) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;

    if (!newToken) {
      clearSessionAndRedirect();
      return Promise.reject(error);
    }

    originalRequest.headers.Authorization = `Bearer ${newToken}`;
    return api(originalRequest);
  },
);

export default api;
