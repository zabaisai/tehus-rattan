# HTTP security: headers, CSP, CORS, cookies, rate limiting, logging, uploads

Staging-hardening layer for the TAKTO CRM. Companion to
[AUTH_SESSION_SECURITY.md](./AUTH_SESSION_SECURITY.md) (browser session/auth) and
[DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) (deploy/backup/rollback).

## 1. Header ownership (no duplication)

Each header has exactly one owner so headers are never duplicated or
contradictory across layers:

| Concern | Owner | Where |
| --- | --- | --- |
| HSTS (`Strict-Transport-Security`) | **Caddy** (TLS edge — only layer that knows the request is HTTPS) | `deploy/Caddyfile` |
| Frontend CSP + security headers | **Next.js** | `apps/frontend/next.config.ts`, `src/lib/csp.ts`, `src/lib/security-headers.ts` |
| API/uploads security headers + CSP | **Helmet (NestJS)** | `apps/backend/src/common/security/security.setup.ts` |
| CORS | **NestJS** | `apps/backend/src/common/security/cors.options.ts` |
| Server-header removal | Caddy (`-Server`) + Helmet (`hidePoweredBy`) | both |

Caddy sets **only** HSTS (and removes `Server`); it no longer sets
`X-Content-Type-Options` / `Referrer-Policy` / a partial CSP — those now come
from the apps.

## 2. API headers (Helmet)

`applySecurityHeaders()` sets, for every API + `/uploads` response:

- `Content-Security-Policy: default-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` — the API returns JSON/images, so deny-by-default is correct.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Cross-Origin-Opener-Policy: same-origin`; `Cross-Origin-Resource-Policy: cross-origin` (so the frontend, a different subdomain, can embed `/uploads` images — reading JSON cross-origin is still gated by CORS).
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`.
- `X-Powered-By` removed. HSTS is **off** here (Caddy owns it). COEP is off (would break third-party product images).

Covered by `test/security-headers.e2e-spec.ts`.

## 3. Frontend CSP (Next.js)

Static header (same value per request → no forced dynamic rendering), built by
`src/lib/csp.ts`:

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
frame-src 'none'; form-action 'self'; script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
font-src 'self'; connect-src 'self' <API_ORIGIN>; upgrade-insecure-requests
```

Documented, deliberate relaxations:

- **`script-src 'unsafe-inline'` (production)** — Next 16's App Router emits inline
  hydration scripts (`self.__next_f.push(...)`) and, under the Turbopack
  production build, does **not** stamp a CSP nonce on them; a nonce /
  `strict-dynamic` policy therefore blocks hydration entirely (verified). This is
  the architecturally-required fallback, scoped to scripts. **`'unsafe-eval'` is
  never allowed in production** (only in dev, for React Fast Refresh). *Debt:* if
  a future Next/Turbopack version applies nonces to inline scripts, switch
  `script-src` to `'self' 'nonce-…' 'strict-dynamic'` (a nonce middleware/proxy)
  and drop `'unsafe-inline'`.
- **`style-src 'unsafe-inline'`** — the app uses inline `style={{}}` attributes and
  next/font injects inline styles; CSP nonces do not reliably cover inline style
  *attributes*.
- **`img-src https:`** — product images are arbitrary user-entered https URLs, so
  they cannot be pinned to a fixed host without breaking the feature. Logos come
  from the API origin; `blob:`/`data:` are local previews.
- `connect-src` is scoped to `'self'` + the API origin; `upgrade-insecure-requests`
  is added only when the API is https (a real TLS deploy).

Dev uses a looser policy (`'unsafe-eval'` + `ws:` for HMR). Staging must run with
`NODE_ENV=production` to get the strict policy. Verified with a real Chrome smoke
(hydration, login, navigation, modals, images → **zero CSP violations**).

Other Next headers (built by `src/lib/security-headers.ts`, unit-tested):
`X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy: same-origin-allow-popups`, and
`poweredByHeader:false`. The COOP value is load-bearing: `same-origin` severs
`window.opener` for the cross-origin popups the page itself opens and breaks
the Meta Embedded Signup return channel (popup completes but no code and no
`WA_EMBEDDED_SIGNUP` message can ever arrive) — see
WHATSAPP_EMBEDDED_SIGNUP.md, "COOP note". The frontend uses no
SharedArrayBuffer / cross-origin isolation, so nothing needs the stricter
value. The API keeps `same-origin` (it never opens popups).

## 4. CORS

`buildCorsOptions()` (shares the allowlist with `CookieOriginGuard` via
`buildAllowedOrigins`):

- Credentialed, **exact-match** allowlist — never a wildcard. Reflected origin
  must equal `FRONTEND_URL` or an entry in `CSRF_ALLOWED_ORIGINS`
  (+ `http://localhost:3000` only outside production).
- A missing Origin (same-origin/curl/probe) is allowed; a present-but-not-allowed
  Origin (including `"null"`) gets **no** CORS headers → the browser blocks it.
- Production with nothing configured → empty allowlist → every cross-origin
  request rejected (**fail-closed**).
- Methods `GET/POST/PATCH/PUT/DELETE/OPTIONS`; headers `Content-Type,Authorization`.

Covered by `test/cors.e2e-spec.ts`. CSRF defense-in-depth on the cookie auth POSTs
is `CookieOriginGuard` (see AUTH_SESSION_SECURITY.md §6).

## 5. Cookies

Refresh + device cookies: `httpOnly`, `secure` when `NODE_ENV=production`,
`sameSite=lax`, minimal `path` (`/api/auth` for refresh, `/` for device-id), no
`Domain` (host-only). The access JWT is **never** a cookie (Authorization: Bearer,
in tab memory only). **Staging must run `NODE_ENV=production`** or the cookies
ship without `Secure` over HTTPS.

## 6. Request limits & validation

- Body: `express.json`/`urlencoded` capped at **1mb** (env `JSON_BODY_LIMIT` /
  `URLENCODED_BODY_LIMIT`) → oversized body ⇒ **413**. Multipart uploads are
  bounded separately by Multer (logo 2MB, product import 50MB), not this JSON cap.
- `ValidationPipe`: `whitelist` + `forbidNonWhitelisted` + `transform` → unknown
  fields are rejected, types coerced.
- Pagination: every list endpoint clamps `limit` to **1–100** (rejects out-of-range
  with 400) — no unbounded `take`.

## 7. Rate limiting

See AUTH_SESSION_SECURITY.md §6b. Global per-IP (`@nestjs/throttler`), except
`POST /auth/refresh` which is bucketed **per device** (hashed httpOnly device-id,
IP fallback) so an office behind one NAT does not self-throttle. Login stays
strictly per-IP. Health endpoints are `@SkipThrottle`.

## 8. Error handling & logging

- **Global exception filter** (`all-exceptions.filter.ts`): unhandled errors →
  generic `500 {statusCode, message:"Internal server error"}` with **no stack or
  detail** in the body (any environment); the stack is logged server-side only.
  HttpException shapes are preserved; a non-HttpException 4xx (e.g. body-parser
  413) keeps its status with a standard reason phrase.
- **Correlation id**: `RequestIdMiddleware` sets `X-Request-Id` (reusing a sane
  caller-supplied one); `HttpLoggerInterceptor` logs one line per request
  (`method path status durationms [req:id]`) with **no headers/cookies/body**.
- **Redaction** (`common/logging/redact.ts`): centralized sensitive-name matcher
  (Authorization, cookies, tokens, JWT, device-id, DATABASE_URL,
  WHATSAPP_APP_SECRET, …) and a phone-number masker (used on the two WhatsApp
  logs that printed full numbers). Never logged: passwords, JWT, refresh/device
  tokens, Authorization, cookies, DB URL, app secret.
- Integration points for an external log/monitoring sink (e.g. shipping the
  structured access log) are left for a later phase — no external SaaS is wired in.

## 9. Uploads

Flow: `POST /companies/me/logo` (2MB) and `POST /products/import` (50MB, embedded
images) → written to `process.cwd()/uploads` (persistent `backend_uploads`
volume), served read-only under `/uploads/*`.

Safeguards (already robust; unchanged): the real file type is decided by
**magic-byte detection** (`detectImageExtension`), not the attacker-controlled
extension/MIME (those are a cheap pre-filter with an allowlist: PNG/JPG/WEBP);
server-generated random filenames (`type-<ts>-<rand>.<ext>`); the storage path is
built from the server-side `companyId`, so there is **no path traversal**; size
capped by Multer. Served with `X-Content-Type-Options: nosniff` (Helmet) so a file
is never MIME-sniffed into script/HTML, and `Cross-Origin-Resource-Policy:
cross-origin` for legitimate cross-subdomain embedding. Verified: `/uploads/../…`
traversal attempts return 404.

*Before production:* uploads live on local disk (fine for single-instance
staging, random names) — move to object storage / access control for horizontal
scale, and add them to off-site backups (the backup script already snapshots the
volume locally).
