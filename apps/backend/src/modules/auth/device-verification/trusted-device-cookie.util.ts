import type { Request, Response } from 'express';
import {
  TRUSTED_DEVICE_COOKIE_PLAIN_NAME,
  TRUSTED_DEVICE_COOKIE_PLAIN_PATH,
  TRUSTED_DEVICE_COOKIE_SECURE_NAME,
  TRUSTED_DEVICE_TTL_MS,
} from './device-verification.constants';

/**
 * Cookie del dispositivo confiable.
 *
 * Con HTTPS se emite `__Host-takto_trusted_device`: el navegador solo acepta
 * ese prefijo si la cookie es `Secure`, tiene `Path=/` y NO declara `Domain`,
 * de modo que ningún subdominio vecino puede escribirla ni leerla. Sin HTTPS
 * (desarrollo) el prefijo sería rechazado, así que se usa el nombre plano con
 * la ruta acotada a `/api/auth`.
 *
 * En ambos casos: `httpOnly` (fuera del alcance de cualquier script),
 * `SameSite=lax` (igual que el refresh: sobrevive a la vuelta desde el correo,
 * no viaja en peticiones de terceros) y la misma vigencia que la fila en base.
 */
export function isSecureCookieEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function trustedDeviceCookieName(): string {
  return isSecureCookieEnv()
    ? TRUSTED_DEVICE_COOKIE_SECURE_NAME
    : TRUSTED_DEVICE_COOKIE_PLAIN_NAME;
}

function cookieOptions() {
  const secure = isSecureCookieEnv();
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    // `__Host-` obliga a la raíz; sin prefijo se acota a las rutas de auth.
    path: secure ? '/' : TRUSTED_DEVICE_COOKIE_PLAIN_PATH,
    // Nunca se declara `domain`: la cookie queda atada al host exacto.
  };
}

export function setTrustedDeviceCookie(res: Response, token: string): void {
  res.cookie(trustedDeviceCookieName(), token, {
    ...cookieOptions(),
    maxAge: TRUSTED_DEVICE_TTL_MS,
  });
}

/** Lee la cookie por cualquiera de los dos nombres posibles. */
export function readTrustedDeviceCookie(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  if (!cookies) return null;
  const valor =
    cookies[TRUSTED_DEVICE_COOKIE_SECURE_NAME] ??
    cookies[TRUSTED_DEVICE_COOKIE_PLAIN_NAME];
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/**
 * Borra la cookie con los dos nombres y las dos rutas posibles: si el entorno
 * cambió de http a https entre dos despliegues, la vieja no debe quedarse.
 */
export function clearTrustedDeviceCookie(res: Response): void {
  res.clearCookie(TRUSTED_DEVICE_COOKIE_SECURE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(TRUSTED_DEVICE_COOKIE_PLAIN_NAME, {
    httpOnly: true,
    secure: isSecureCookieEnv(),
    sameSite: 'lax',
    path: TRUSTED_DEVICE_COOKIE_PLAIN_PATH,
  });
}
