import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, resolveApiOrigin } from "./csp";

const api = "https://api.example.com";

describe("resolveApiOrigin", () => {
  it("strips the /api path to the bare origin", () => {
    expect(resolveApiOrigin("https://api.example.com/api")).toBe(api);
  });
  it("falls back to the local backend origin when unset/invalid", () => {
    expect(resolveApiOrigin(undefined)).toBe("http://localhost:3001");
    expect(resolveApiOrigin("not-a-url")).toBe("http://localhost:3001");
  });
});

describe("buildContentSecurityPolicy (Meta Embedded Signup)", () => {
  const base = buildContentSecurityPolicy({ apiOrigin: api, isDev: false });
  const withMeta = buildContentSecurityPolicy({
    apiOrigin: api,
    isDev: false,
    metaSdk: true,
  });

  it("keeps frame-src 'none' and no facebook origins when the feature is off", () => {
    expect(base).toContain("frame-src 'none'");
    expect(base).not.toContain("facebook");
  });

  it("allows the Facebook SDK script/frame/connect only when metaSdk is enabled", () => {
    expect(withMeta).toContain("https://connect.facebook.net");
    expect(withMeta).toContain("frame-src https://www.facebook.com");
    // xd_arbiter relay frame: without it FB.login never delivers the code.
    expect(withMeta).toContain("https://staticxx.facebook.com");
    expect(withMeta).toContain("https://graph.facebook.com");
    // Still no eval, still self-based.
    expect(withMeta).not.toContain("'unsafe-eval'");
    expect(withMeta).toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("buildContentSecurityPolicy (Turnstile)", () => {
  const base = buildContentSecurityPolicy({ apiOrigin: api, isDev: false });
  const withTs = buildContentSecurityPolicy({
    apiOrigin: api,
    isDev: false,
    turnstile: true,
  });

  it("no incluye challenges.cloudflare.com cuando está apagado", () => {
    expect(base).not.toContain("challenges.cloudflare.com");
    expect(base).toContain("frame-src 'none'");
  });

  it("permite el script/frame/connect de Turnstile solo cuando está activo", () => {
    expect(withTs).toContain(
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    );
    expect(withTs).toContain("frame-src https://challenges.cloudflare.com");
    expect(withTs).toContain(
      "connect-src 'self' " + api + " " + api.replace(/^http/, "ws") +
        " https://challenges.cloudflare.com",
    );
    expect(withTs).not.toContain("'unsafe-eval'");
  });
});

describe("buildContentSecurityPolicy (production)", () => {
  const csp = buildContentSecurityPolicy({ apiOrigin: api, isDev: false });

  it("allows inline scripts (documented Next debt) but NEVER eval in production", () => {
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("locks object/base/frame-ancestors/form-action", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("scopes connect-src to self + the API origin", () => {
    expect(csp).toContain(`connect-src 'self' ${api}`);
  });

  it("permits inline styles (documented) and broad image sources", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob: https:");
  });

  it("upgrades insecure requests when the API is https", () => {
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("does NOT upgrade when the API is http (local prod-mode run)", () => {
    const httpCsp = buildContentSecurityPolicy({
      apiOrigin: "http://localhost:3001",
      isDev: false,
    });
    expect(httpCsp).not.toContain("upgrade-insecure-requests");
    expect(httpCsp).toContain("connect-src 'self' http://localhost:3001");
  });
});

describe("buildContentSecurityPolicy (development)", () => {
  const csp = buildContentSecurityPolicy({
    apiOrigin: "http://localhost:3001",
    isDev: true,
  });

  it("relaxes script-src for HMR/Fast-Refresh and allows the ws origin", () => {
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });

  it("does not upgrade-insecure-requests in dev (plain http)", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe('canal de tiempo real', () => {
  it('permite wss hacia el mismo host que la API en produccion', () => {
    const csp = buildContentSecurityPolicy({
      apiOrigin: 'https://api.ejemplo.com',
      isDev: false,
    });

    expect(csp).toContain('wss://api.ejemplo.com');
  });

  it('no abre wss hacia cualquier host', () => {
    const csp = buildContentSecurityPolicy({
      apiOrigin: 'https://api.ejemplo.com',
      isDev: false,
    });

    expect(csp).not.toContain('connect-src wss:');
    expect(csp).not.toMatch(/connect-src[^;]*\swss:\s/);
  });
});
