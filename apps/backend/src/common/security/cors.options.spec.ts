import { buildCorsOptions } from './cors.options';

// Regresión del bug de onboarding (2026-09-01): el frontend envía el código
// de invitación en X-Onboarding-Invite-Code (el guard corre antes de que
// Multer procese el multipart), pero allowedHeaders no lo incluía y el
// preflight OPTIONS moría en el navegador con "Request header field
// x-onboarding-invite-code is not allowed by Access-Control-Allow-Headers".
// Estas pruebas fijan la lista explícita de encabezados y la política de
// orígenes para que ninguno de los dos se relaje o se rompa en silencio.

const ALLOWED = 'https://crm-staging.example.com';

function optionsFor(env: Record<string, string> = {}) {
  return buildCorsOptions({
    FRONTEND_URL: ALLOWED,
    NODE_ENV: 'production',
    ...env,
  });
}

type OriginCallback = (err: Error | null, allow?: boolean) => void;
type OriginFn = (origin: string | undefined, cb: OriginCallback) => void;

function resolveOrigin(origin: string | undefined): boolean | undefined {
  let allowed: boolean | undefined;
  (optionsFor().origin as OriginFn)(origin, (err, allow) => {
    expect(err).toBeNull();
    allowed = allow;
  });
  return allowed;
}

describe('buildCorsOptions', () => {
  it('permite X-Onboarding-Invite-Code (el preflight del onboarding lo exige)', () => {
    expect(optionsFor().allowedHeaders).toContain('X-Onboarding-Invite-Code');
  });

  it('mantiene Content-Type y Authorization permitidos', () => {
    const headers = optionsFor().allowedHeaders;
    expect(headers).toContain('Content-Type');
    expect(headers).toContain('Authorization');
  });

  it('la lista de encabezados es explícita: sin wildcard y sin extras', () => {
    expect(optionsFor().allowedHeaders).toEqual([
      'Content-Type',
      'Authorization',
      'X-Onboarding-Invite-Code',
    ]);
  });

  it('un origen autorizado se acepta y las credenciales siguen activas', () => {
    expect(resolveOrigin(ALLOWED)).toBe(true);
    expect(optionsFor().credentials).toBe(true);
  });

  it('un origen extranjero no recibe autorización', () => {
    expect(resolveOrigin('https://evil.example.com')).toBe(false);
  });

  it('la política de origen nunca es wildcard: es un callback de allowlist exacta', () => {
    expect(typeof optionsFor().origin).toBe('function');
    expect(optionsFor().origin).not.toBe('*');
    // Un origen "parecido" tampoco pasa (el match es exacto).
    expect(resolveOrigin(`${ALLOWED}.evil.example.com`)).toBe(false);
  });
});
