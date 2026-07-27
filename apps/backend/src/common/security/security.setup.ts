import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

// Centralized HTTP security headers for the API (and the statically served
// /uploads). Extracted so main.ts and the header e2e test apply the EXACT same
// configuration.
//
// Layer responsibility (kept non-duplicating on purpose):
//  - Caddy (the TLS edge) owns HSTS — it is the only layer that truly knows the
//    request arrived over HTTPS, so Helmet's HSTS is disabled here to avoid a
//    duplicated / contradictory Strict-Transport-Security header.
//  - Next.js owns the Content-Security-Policy for HTML responses (per-request
//    nonce). This API is JSON + images only, so it ships its own tight CSP.
//  - This function owns the API/uploads response headers below.
export function applySecurityHeaders(app: INestApplication): void {
  app.use(
    helmet({
      // The API returns JSON and (under /uploads) images — never HTML it wants a
      // browser to execute. A deny-by-default CSP is correct and harmless for
      // those responses; it also hardens the case of a URL opened directly.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'img-src': ["'self'", 'data:'],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
      // Caddy owns HSTS (see note above).
      hsts: false,
      // Let the frontend (a different subdomain in staging) embed /uploads
      // images cross-origin. Reading JSON cross-origin is still gated by CORS.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      // The API is never meant to be framed — DENY is stricter than Helmet's
      // SAMEORIGIN default and matches the CSP frame-ancestors 'none'.
      frameguard: { action: 'deny' },
      // COEP is intentionally OFF — it would require CORP on every subresource
      // and break third-party product image URLs with no security benefit here.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      // Defaults left ON: X-Content-Type-Options: nosniff, X-Frame-Options:
      // DENY, X-DNS-Prefetch-Control, Origin-Agent-Cluster, and hidePoweredBy
      // (removes Express's X-Powered-By).
    }),
  );

  // Permissions-Policy: Helmet no longer manages this header. Lock every
  // powerful feature the API never needs.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    );
    next();
  });
}
