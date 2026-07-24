import { getMe } from "@/lib/auth";
import { refreshAccessToken } from "@/lib/axios";
import { clearAccessToken } from "@/lib/auth-token";
import { useAuthStore } from "@/store/auth.store";

// Runs once per tab load. Reuses the SAME single-flight refresh as the axios
// interceptor, so a bootstrap racing with an early 401 never fires two
// refreshes. Resolves the initial auth status:
//  - refresh 200 + /auth/me ok  -> authenticated (token in memory only)
//  - refresh 401 / me fails      -> anonymous
let bootstrapPromise: Promise<void> | null = null;

export function bootstrapSession(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = doBootstrap();
  }
  return bootstrapPromise;
}

async function doBootstrap(): Promise<void> {
  const store = useAuthStore.getState();

  const token = await refreshAccessToken();
  if (!token) {
    clearAccessToken();
    store.setStatus("anonymous");
    return;
  }

  try {
    const user = await getMe();
    store.setSession(user, token);
  } catch {
    // Session vanished between refresh and /auth/me (e.g. just revoked).
    store.clearSession();
  }
}

// Test-only: lets a test reset the module-level single-flight guard.
export function __resetBootstrapForTests(): void {
  bootstrapPromise = null;
}
