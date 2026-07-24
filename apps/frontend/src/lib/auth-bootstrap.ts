import { getMe } from "@/lib/auth";
import { refreshAccessToken, classifyRefreshError } from "@/lib/axios";
import { clearAccessToken } from "@/lib/auth-token";
import { useAuthStore } from "@/store/auth.store";

// Runs once per tab load. Reuses the SAME single-flight refresh as the axios
// interceptor, so a bootstrap racing with an early 401 never fires two
// refreshes. Resolves the initial auth status:
//  - refresh success + /auth/me ok      -> authenticated (token in memory only)
//  - refresh invalid-session / me 401   -> anonymous
//  - refresh transient/config, or /me
//    fails transiently                  -> unavailable (retryable; NOT login)
//
// The key rule: a transient failure to REACH the server must never masquerade as
// "your session expired". Only a real invalid session ends anonymous.
let bootstrapPromise: Promise<void> | null = null;

export function bootstrapSession(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = doBootstrap();
  }
  return bootstrapPromise;
}

// Re-run the bootstrap from scratch (e.g. the "Retry" button on the unavailable
// screen). Clears the single-flight guard and returns to the bootstrapping state
// so the UI shows the loader again while the new attempt runs.
export function retryBootstrap(): Promise<void> {
  bootstrapPromise = null;
  useAuthStore.getState().setStatus("bootstrapping");
  return bootstrapSession();
}

async function doBootstrap(): Promise<void> {
  const store = useAuthStore.getState();

  const result = await refreshAccessToken();

  if (result.status === "success") {
    try {
      const user = await getMe();
      store.setSession(user, result.token);
    } catch (error) {
      // We hold a fresh token, but /auth/me did not confirm the profile.
      if (classifyRefreshError(error) === "invalid") {
        // Session vanished between refresh and /auth/me (e.g. just revoked).
        store.clearSession();
      } else {
        // Server hiccup (5xx / network): don't drop to login, offer a retry.
        store.setStatus("unavailable");
      }
    }
    return;
  }

  if (result.status === "invalid-session") {
    clearAccessToken();
    store.setStatus("anonymous");
    return;
  }

  // transient-error | configuration-error: we could not determine whether the
  // session is alive. Never show the login form as if it expired — surface a
  // retryable "unavailable" state instead.
  clearAccessToken();
  store.setStatus("unavailable");
}

// Test-only: lets a test reset the module-level single-flight guard.
export function __resetBootstrapForTests(): void {
  bootstrapPromise = null;
}
