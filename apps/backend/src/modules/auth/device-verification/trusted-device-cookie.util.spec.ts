import {
  clearTrustedDeviceCookie,
  readTrustedDeviceCookie,
  setTrustedDeviceCookie,
  trustedDeviceCookieName,
} from './trusted-device-cookie.util';
import { TRUSTED_DEVICE_TTL_MS } from './device-verification.constants';

describe('cookie del dispositivo confiable', () => {
  const entornoOriginal = process.env.NODE_ENV;
  let res: any;

  beforeEach(() => {
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
  });

  afterEach(() => {
    process.env.NODE_ENV = entornoOriginal;
  });

  describe('con HTTPS (staging y producción)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('usa el prefijo __Host-', () => {
      expect(trustedDeviceCookieName()).toBe('__Host-takto_trusted_device');
    });

    it('la emite Secure, httpOnly, SameSite=lax, Path=/ y SIN Domain', () => {
      setTrustedDeviceCookie(res, 'token-opaco');

      const [nombre, valor, opciones] = res.cookie.mock.calls[0];
      expect(nombre).toBe('__Host-takto_trusted_device');
      expect(valor).toBe('token-opaco');
      expect(opciones).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: TRUSTED_DEVICE_TTL_MS,
      });
      // `__Host-` exige que no haya Domain: si lo hubiera, el navegador
      // rechazaría la cookie entera.
      expect(opciones).not.toHaveProperty('domain');
    });
  });

  describe('sin HTTPS (desarrollo)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('usa el nombre plano, porque __Host- exige Secure', () => {
      expect(trustedDeviceCookieName()).toBe('takto_trusted_device');
    });

    it('acota la ruta a /api/auth y no marca Secure', () => {
      setTrustedDeviceCookie(res, 'token-opaco');
      const [nombre, , opciones] = res.cookie.mock.calls[0];
      expect(nombre).toBe('takto_trusted_device');
      expect(opciones).toMatchObject({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/auth',
      });
    });
  });

  describe('lectura', () => {
    it('encuentra la cookie con prefijo', () => {
      const req = {
        cookies: { '__Host-takto_trusted_device': 'abc' },
      } as never;
      expect(readTrustedDeviceCookie(req)).toBe('abc');
    });

    it('encuentra la cookie sin prefijo', () => {
      const req = { cookies: { takto_trusted_device: 'abc' } } as never;
      expect(readTrustedDeviceCookie(req)).toBe('abc');
    });

    it('devuelve null cuando no hay cookies o está vacía', () => {
      expect(readTrustedDeviceCookie({} as never)).toBeNull();
      expect(readTrustedDeviceCookie({ cookies: {} } as never)).toBeNull();
      expect(
        readTrustedDeviceCookie({
          cookies: { takto_trusted_device: '' },
        } as never),
      ).toBeNull();
    });
  });

  it('al borrar limpia los dos nombres posibles', () => {
    clearTrustedDeviceCookie(res);
    const nombres = res.clearCookie.mock.calls.map((c: any[]) => c[0]);
    expect(nombres).toEqual([
      '__Host-takto_trusted_device',
      'takto_trusted_device',
    ]);
  });
});
