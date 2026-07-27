import type { NextConfig } from "next";
import { buildContentSecurityPolicy, resolveApiOrigin } from "./src/lib/csp";

// Security headers set on every response. HSTS is intentionally NOT set here —
// the Caddy TLS edge owns it, so it is never duplicated or sent over plain HTTP.
// The CSP is a static header (no per-request nonce; see src/lib/csp.ts for why).
const isDev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = buildContentSecurityPolicy({
  apiOrigin: resolveApiOrigin(process.env.NEXT_PUBLIC_API_URL),
  isDev,
});

const securityHeaders = [
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
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Produces a self-contained `.next/standalone` server (only the traced
  // node_modules the app actually needs), which is what the production
  // Docker image copies instead of the full node_modules tree.
  output: "standalone",
  // Don't advertise the framework version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
