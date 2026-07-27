// Single source of truth for the browser-origin allowlist, shared by the CORS
// config (main.ts) and the CookieOriginGuard (CSRF defense-in-depth) so the two
// can never drift apart.
//
//  - CSRF_ALLOWED_ORIGINS: optional comma-separated extra origins.
//  - FRONTEND_URL: the primary app origin.
//  - http://localhost:3000 is added ONLY outside production (dev / E2E).
//
// In production with neither FRONTEND_URL nor CSRF_ALLOWED_ORIGINS set, the list
// is empty → every cross-origin request is rejected (fail-closed on misconfig).
export function buildAllowedOrigins(env: {
  CSRF_ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;
  NODE_ENV?: string;
}): string[] {
  const origins: string[] = [];

  if (env.CSRF_ALLOWED_ORIGINS) {
    origins.push(
      ...env.CSRF_ALLOWED_ORIGINS.split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  const frontend = env.FRONTEND_URL?.trim();
  if (frontend) origins.push(frontend);

  if (env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000');
  }

  return origins;
}
