import type { NextConfig } from "next";
import { buildContentSecurityPolicy, resolveApiOrigin } from "./src/lib/csp";
import { verificarUrlDeApi, verificarCaptcha } from "./src/lib/build-guard";

// Security headers set on every response. HSTS is intentionally NOT set here —
// the Caddy TLS edge owns it, so it is never duplicated or sent over plain HTTP.
// The CSP is a static header (no per-request nonce; see src/lib/csp.ts for why).
const isDev = process.env.NODE_ENV !== "production";

// Falla la construcción de producción si la URL de la API no está. Sin esto,
// el bundle sale sin baseURL y TODAS las llamadas van contra el propio
// frontend: 404 en cada pantalla, con la imagen construida, el contenedor
// healthy, el health en `ok` y el smoke test en verde. Ver src/lib/build-guard.ts.
verificarUrlDeApi(process.env.NEXT_PUBLIC_API_URL, !isDev);
// Coherencia del antibot: si el despliegue lo declara obligatorio, la site key
// pública tiene que estar presente o la construcción de producción se niega.
verificarCaptcha(
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  process.env.NEXT_PUBLIC_TURNSTILE_REQUIRED === "true",
  !isDev,
);
const contentSecurityPolicy = buildContentSecurityPolicy({
  apiOrigin: resolveApiOrigin(process.env.NEXT_PUBLIC_API_URL),
  isDev,
  // Only relax the CSP for Meta's SDK when the Embedded Signup app id is present
  // at build time; otherwise the policy stays fully locked down.
  metaSdk: Boolean(process.env.NEXT_PUBLIC_WHATSAPP_APP_ID),
  // Relaja la CSP para Turnstile solo si la site key pública está presente en
  // build; si no, la política sigue cerrada.
  turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
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
