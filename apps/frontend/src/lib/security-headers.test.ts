import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

const headers = buildSecurityHeaders("default-src 'self'");
const get = (key: string) => headers.find((h) => h.key === key)?.value;

describe("buildSecurityHeaders", () => {
  it("incluye la CSP recibida y los headers base", () => {
    expect(get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("Permissions-Policy")).toContain("camera=()");
  });

  // Causa raíz de los fallos de Embedded Signup en staging: con COOP
  // 'same-origin' el popup cross-origin de Meta queda en otro grupo de
  // contextos, window.opener es null dentro del popup y el canal
  // postMessage/xd_arbiter muere por diseño (callback 'unknown' a los
  // segundos, cero WA_EMBEDDED_SIGNUP). El valor requerido es
  // 'same-origin-allow-popups'; este test impide una regresión silenciosa.
  it("COOP es same-origin-allow-popups (nunca same-origin: rompe el retorno del Embedded Signup)", () => {
    expect(get("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
  });

  it("no fija HSTS (lo posee el edge TLS de Caddy) ni COEP (no hay aislamiento cross-origin)", () => {
    expect(get("Strict-Transport-Security")).toBeUndefined();
    expect(get("Cross-Origin-Embedder-Policy")).toBeUndefined();
  });
});
