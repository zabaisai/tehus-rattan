import { describe, expect, it } from 'vitest';
import { verificarUrlDeApi } from './build-guard';

describe('verificarUrlDeApi', () => {
  describe('el fallo que llego a staging', () => {
    it('REPRODUCE EL FALLO: cadena vacia en produccion detiene la construccion', () => {
      // Esto es exactamente lo que ocurrio: `docker compose build` sin
      // `--env-file` interpolo `${NEXT_PUBLIC_API_URL}` como cadena vacia.
      // La imagen se construyo, el contenedor quedo healthy, el health dijo
      // `ok` y el smoke test paso entero — con la aplicacion inservible.
      expect(() => verificarUrlDeApi('', true)).toThrow(/vacía/i);
    });

    it('el mensaje dice COMO construir bien, no solo que fallo', () => {
      // Un error que no dice el remedio obliga a reconstruir el diagnostico
      // entero cada vez.
      expect(() => verificarUrlDeApi('', true)).toThrow(/--env-file/);
    });

    it('undefined se trata igual que vacia', () => {
      expect(() => verificarUrlDeApi(undefined, true)).toThrow(/vacía/i);
    });

    it('solo espacios tampoco vale', () => {
      expect(() => verificarUrlDeApi('   ', true)).toThrow(/vacía/i);
    });
  });

  describe('rutas relativas', () => {
    it('rechaza una ruta relativa: volveria a llamar al propio frontend', () => {
      // El sintoma seria identico al fallo original: 404 contra el frontend.
      expect(() => verificarUrlDeApi('/api', true)).toThrow(/absoluta/i);
    });

    it('rechaza un host sin esquema', () => {
      expect(() => verificarUrlDeApi('api.ejemplo.com/api', true)).toThrow(
        /absoluta/i,
      );
    });

    it('el mensaje incluye lo recibido, para no adivinar', () => {
      expect(() => verificarUrlDeApi('/api', true)).toThrow(/"\/api"/);
    });
  });

  describe('valores validos', () => {
    it('acepta https con ruta', () => {
      expect(() =>
        verificarUrlDeApi('https://api.ejemplo.com/api', true),
      ).not.toThrow();
    });

    it('acepta http (entornos internos sin TLS)', () => {
      expect(() => verificarUrlDeApi('http://localhost:3001/api', true)).not.toThrow();
    });

    it('tolera espacios alrededor', () => {
      expect(() =>
        verificarUrlDeApi('  https://api.ejemplo.com/api  ', true),
      ).not.toThrow();
    });
  });

  describe('desarrollo', () => {
    it('en desarrollo se permite vacia: el proxy local resuelve las rutas', () => {
      expect(() => verificarUrlDeApi('', false)).not.toThrow();
      expect(() => verificarUrlDeApi(undefined, false)).not.toThrow();
    });
  });
});
