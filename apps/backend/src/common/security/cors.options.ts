import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { buildAllowedOrigins } from './allowed-origins';

// CORS for the API. Credentialed (the frontend sends the httpOnly cookies), so
// the reflected origin must be an EXACT allowlist match — never a wildcard.
//
//  - A missing Origin (same-origin, curl, server-to-server, health probes) is
//    allowed; browsers always send Origin on cross-origin requests and CSRF on
//    the credentialed auth POSTs is separately enforced fail-closed by
//    CookieOriginGuard.
//  - A present-but-not-allowed Origin gets NO CORS headers (cb(null, false)),
//    so the browser blocks the response (we never throw → preflight stays 204).
//  - In production with neither FRONTEND_URL nor CSRF_ALLOWED_ORIGINS the
//    allowlist is empty → every cross-origin request is rejected (fail-closed).
export function buildCorsOptions(env: {
  CSRF_ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;
  NODE_ENV?: string;
}): CorsOptions {
  const allowed = new Set(buildAllowedOrigins(env));
  return {
    origin: (origin, cb) => {
      if (!origin || allowed.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  };
}
