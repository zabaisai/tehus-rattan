import * as crypto from 'crypto';
import {
  digestCode,
  digestMatches,
  generateVerificationCode,
  isWellFormedCode,
  maskEmail,
} from './device-code.util';

const SECRETO = 'secreto-de-prueba-que-no-se-usa-en-ningun-entorno-real';

describe('device-code.util', () => {
  describe('generateVerificationCode', () => {
    it('devuelve seis dígitos, siempre', () => {
      for (let i = 0; i < 500; i++) {
        const code = generateVerificationCode();
        expect(code).toMatch(/^\d{6}$/);
        expect(code).toHaveLength(6);
      }
    });

    it('conserva los ceros a la izquierda en vez de acortar el código', () => {
      // `000042` es tan válido como `421337`: recortarlo dejaría fuera una
      // décima parte del espacio. Se comprueba por comportamiento —con dos mil
      // códigos, que ninguno empiece por cero es prácticamente imposible— en
      // vez de espiando `crypto`, que el módulo importa por valor.
      const codigos = Array.from({ length: 2000 }, generateVerificationCode);
      expect(codigos.every((c) => c.length === 6)).toBe(true);
      expect(codigos.some((c) => c.startsWith('0'))).toBe(true);
    });

    it('no usa Math.random', () => {
      const random = jest.spyOn(Math, 'random');
      generateVerificationCode();
      expect(random).not.toHaveBeenCalled();
      random.mockRestore();
    });

    it('cubre todo el rango de seis dígitos, no solo una parte', () => {
      const codigos = Array.from({ length: 3000 }, generateVerificationCode);
      const numeros = codigos.map(Number);
      expect(Math.min(...numeros)).toBeLessThan(100000);
      expect(Math.max(...numeros)).toBeGreaterThan(899999);
    });

    it('no repite el mismo código una y otra vez', () => {
      const vistos = new Set<string>();
      for (let i = 0; i < 200; i++) vistos.add(generateVerificationCode());
      expect(vistos.size).toBeGreaterThan(150);
    });
  });

  describe('isWellFormedCode', () => {
    it.each(['000000', '123456', '999999'])('acepta %s', (code) => {
      expect(isWellFormedCode(code)).toBe(true);
    });

    it.each(['12345', '1234567', '12345a', '', ' 123456', '12 3456'])(
      'rechaza %s',
      (code) => {
        expect(isWellFormedCode(code)).toBe(false);
      },
    );
  });

  describe('digestCode', () => {
    it('es determinista para el mismo código, reto y secreto', () => {
      expect(digestCode('123456', 'reto-1', SECRETO)).toBe(
        digestCode('123456', 'reto-1', SECRETO),
      );
    });

    it('el mismo código en OTRO reto da otra huella', () => {
      expect(digestCode('123456', 'reto-1', SECRETO)).not.toBe(
        digestCode('123456', 'reto-2', SECRETO),
      );
    });

    it('con otro secreto da otra huella (el secreto es lo que protege)', () => {
      expect(digestCode('123456', 'reto-1', SECRETO)).not.toBe(
        digestCode('123456', 'reto-1', SECRETO + 'x'),
      );
    });

    it('no es un SHA-256 desnudo del código: sin el secreto no se precalcula', () => {
      const sha = crypto.createHash('sha256').update('123456').digest('hex');
      expect(digestCode('123456', 'reto-1', SECRETO)).not.toBe(sha);
    });

    it('devuelve hexadecimal de 64 caracteres (SHA-256)', () => {
      expect(digestCode('123456', 'reto-1', SECRETO)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('nunca contiene el código en claro', () => {
      expect(digestCode('424242', 'reto-1', SECRETO)).not.toContain('424242');
    });
  });

  describe('digestMatches', () => {
    it('reconoce dos huellas iguales', () => {
      const d = digestCode('123456', 'reto-1', SECRETO);
      expect(digestMatches(d, d)).toBe(true);
    });

    it('rechaza huellas distintas', () => {
      expect(
        digestMatches(
          digestCode('123456', 'reto-1', SECRETO),
          digestCode('654321', 'reto-1', SECRETO),
        ),
      ).toBe(false);
    });

    it('rechaza longitudes distintas sin lanzar', () => {
      expect(digestMatches('abc', 'abcdef')).toBe(false);
    });
  });

  describe('maskEmail', () => {
    it.each([
      ['isabel@gmail.com', 'is***@gmail.com'],
      ['ana@takto.online', 'an***@takto.online'],
      ['a@b.co', 'a***@b.co'],
    ])('%s → %s', (entrada, salida) => {
      expect(maskEmail(entrada)).toBe(salida);
    });

    it('nunca deja ver el buzón completo', () => {
      const enmascarado = maskEmail('administracion@empresa.test');
      expect(enmascarado).not.toContain('administracion');
      expect(enmascarado).toContain('@empresa.test');
    });

    it('no revela nada si el valor no parece un correo', () => {
      expect(maskEmail('sin-arroba')).toBe('***');
    });
  });
});
