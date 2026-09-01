// Security headers set on every frontend response. Built here (same pattern
// as csp.ts) so unit tests can pin them; next.config.ts wires the list into
// its headers() hook. HSTS is intentionally NOT here — the Caddy TLS edge
// owns it (see docs/SECURITY_HEADERS.md).
export function buildSecurityHeaders(
  contentSecurityPolicy: string,
): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Redundant with CSP frame-ancestors 'none' but covers older browsers.
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    // MUST be 'same-origin-allow-popups', not 'same-origin'. With
    // 'same-origin' the browser puts any cross-origin popup THIS page opens
    // (Meta's Embedded Signup dialog on facebook.com) into a separate
    // browsing-context group: window.opener is null inside the popup and the
    // postMessage / xd_arbiter channel dies by design. Observed in staging as
    // the FB.login callback returning status 'unknown' within seconds and
    // ZERO WA_EMBEDDED_SIGNUP messages over the whole flow, even though the
    // user completes the popup (see docs/WHATSAPP_EMBEDDED_SIGNUP.md).
    // 'same-origin-allow-popups' keeps this page out of reach of pages that
    // open IT, while preserving the opener link of popups it opens itself.
    // Nothing in the frontend needs cross-origin isolation
    // (SharedArrayBuffer / crossOriginIsolated), which is what would require
    // 'same-origin' + COEP.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
}
