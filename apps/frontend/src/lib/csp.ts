// Builds the Content-Security-Policy string. Pure + unit-tested; consumed by
// next.config.ts as a static response header (same value for every request, so
// no per-request nonce and no forced dynamic rendering).
//
// script-src uses 'unsafe-inline' (NOT 'unsafe-eval') in production. Why: Next
// 16's App Router emits inline hydration scripts (self.__next_f.push(...)) and,
// under the Turbopack production build, does NOT stamp a CSP nonce on them — so
// a nonce/'strict-dynamic' policy blocks hydration entirely. 'unsafe-inline' is
// the architecturally-required, documented fallback (see docs/SECURITY_HEADERS.md).
// It is scoped to scripts only; eval stays blocked in production.
//
// Other deliberate relaxations:
//  - style-src 'unsafe-inline': inline style={{}} attributes + next/font styles.
//  - img-src https:: product images are arbitrary user-entered https URLs.
export function buildContentSecurityPolicy(opts: {
  apiOrigin: string;
  isDev: boolean;
  // When true (only when NEXT_PUBLIC_WHATSAPP_APP_ID is configured at build
  // time), allow Meta's Facebook JS SDK to load and run the Embedded Signup
  // flow. This is the ONLY relaxation for Meta; the app secret is never in the
  // browser and no other third-party origin is allowed.
  metaSdk?: boolean;
}): string {
  const { apiOrigin, isDev, metaSdk } = opts;

  const META_SCRIPT = 'https://connect.facebook.net';
  // staticxx.facebook.com hosts the SDK's hidden xd_arbiter relay iframe — the
  // channel through which the FB.login popup returns the OAuth code to the
  // opener. Without it the signup completes on Meta's side but the code never
  // reaches the page (FB.login calls back with a null authResponse).
  const META_FRAME =
    'https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com';
  const META_CONNECT = 'https://graph.facebook.com https://www.facebook.com';

  // Dev additionally needs 'unsafe-eval' for React Fast Refresh; prod never does.
  let scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'unsafe-inline'`;
  if (metaSdk) scriptSrc += ` ${META_SCRIPT}`;

  // El canal de tiempo real va al MISMO host que la API, en wss. La
  // especificacion dice que un origen https cubre tambien wss, pero se declara
  // explicito: no todos los navegadores lo aplicaron siempre igual, y el
  // sintoma de fallar seria un canal que no conecta sin error visible.
  const wsOrigin = apiOrigin.replace(/^http/i, 'ws');

  let connectSrc = isDev
    ? `'self' ${apiOrigin} ws: wss:`
    : `'self' ${apiOrigin} ${wsOrigin}`;
  if (metaSdk) connectSrc += ` ${META_CONNECT}`;

  const frameSrc = metaSdk ? META_FRAME : `'none'`;

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `frame-src ${frameSrc}`,
    `form-action 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
  ];

  // Upgrade accidental http subresources to https — but only for a real TLS
  // deployment (https API). Skipped when the API is http (a local prod-mode run)
  // so it does not upgrade and break that http API call.
  if (!isDev && /^https:/i.test(apiOrigin)) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

// The API's ORIGIN (scheme://host[:port]) derived from NEXT_PUBLIC_API_URL,
// which ends in /api. Falls back to the local backend origin.
export function resolveApiOrigin(apiUrl: string | undefined): string {
  try {
    return new URL(apiUrl ?? 'http://localhost:3001/api').origin;
  } catch {
    return 'http://localhost:3001';
  }
}
