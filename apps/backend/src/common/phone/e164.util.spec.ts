import { normalizePhone, isSamePhone, phoneLookupVariants } from './e164.util';

// Todos los números son ficticios. El rango 300 111 xxxx no corresponde a
// ninguna línea real usada por el proyecto.
describe('normalizePhone', () => {
  describe('el caso que motivó el utilitario', () => {
    it('normaliza el wa_id de Meta, que llega sin "+"', () => {
      // Es exactamente la forma en que están los 4 contactos reales de
      // staging, creados por el webhook.
      expect(normalizePhone('573001112233').e164).toBe('+573001112233');
    });

    it('las tres formas del mismo número colapsan en una sola', () => {
      const formas = ['573001112233', '+573001112233', '3001112233'];
      const canonicas = formas.map((f) => normalizePhone(f).e164);

      expect(new Set(canonicas).size).toBe(1);
      expect(canonicas[0]).toBe('+573001112233');
    });
  });

  describe('nacional colombiano', () => {
    it.each([
      ['3001112233', '+573001112233'],
      ['300 111 2233', '+573001112233'],
      ['300-111-2233', '+573001112233'],
      ['(300) 111 2233', '+573001112233'],
    ])('normaliza %s a %s', (input, esperado) => {
      expect(normalizePhone(input).e164).toBe(esperado);
    });
  });

  describe('internacional: nunca se reinterpreta el indicativo', () => {
    it.each([
      ['+13055551234', '+13055551234'], // EEUU
      ['+34911223344', '+34911223344'], // España
      ['+5215512345678', '+5215512345678'], // México
      ['+442071838750', '+442071838750'], // Reino Unido
    ])('respeta %s', (input, esperado) => {
      expect(normalizePhone(input).e164).toBe(esperado);
    });

    it('un número con "+" NUNCA recibe el indicativo por defecto', () => {
      // Este es el error clásico: tomar un número que ya declara país y
      // anteponerle el propio. Un contacto internacional quedaría inalcanzable.
      const resultado = normalizePhone('+13055551234');

      expect(resultado.e164).toBe('+13055551234');
      expect(resultado.e164?.startsWith('+57')).toBe(false);
    });

    it('trata 00 como prefijo internacional de marcación', () => {
      expect(normalizePhone('0013055551234').e164).toBe('+13055551234');
    });

    it('no confunde un 00 interior con prefijo internacional', () => {
      expect(normalizePhone('+573001002233').e164).toBe('+573001002233');
    });
  });

  describe('entradas no normalizables', () => {
    it.each([[''], ['   '], [null], [undefined], ['abc'], ['+++']])(
      'devuelve null para %s sin lanzar',
      (input) => {
        expect(() => normalizePhone(input as never)).not.toThrow();
        expect(normalizePhone(input as never).e164).toBeNull();
      },
    );

    it('rechaza un número demasiado corto', () => {
      expect(normalizePhone('12345').e164).toBeNull();
    });

    it('rechaza un número que excede los 15 dígitos de E.164', () => {
      expect(normalizePhone('+1234567890123456').e164).toBeNull();
    });

    it('conserva los dígitos aunque no sea normalizable, para diagnóstico', () => {
      expect(normalizePhone('12345').digits).toBe('12345');
    });
  });

  it('marca si la entrada ya venía en forma canónica', () => {
    expect(normalizePhone('+573001112233').wasAlreadyE164).toBe(true);
    expect(normalizePhone('573001112233').wasAlreadyE164).toBe(false);
    expect(normalizePhone('3001112233').wasAlreadyE164).toBe(false);
  });

  it('permite otro indicativo por defecto sin tocar el utilitario', () => {
    expect(normalizePhone('9112233445', '34').e164).toBe('+349112233445');
  });
});

describe('isSamePhone', () => {
  it('reconoce como iguales las formas del mismo número', () => {
    expect(isSamePhone('573001112233', '+573001112233')).toBe(true);
    expect(isSamePhone('3001112233', '+57 300 111 2233')).toBe(true);
  });

  it('distingue números realmente distintos', () => {
    expect(isSamePhone('+573001112233', '+573001112234')).toBe(false);
  });

  it('no confunde un nacional colombiano con un internacional parecido', () => {
    expect(isSamePhone('3001112233', '+13001112233')).toBe(false);
  });

  it('dos entradas no normalizables solo son iguales si coinciden literalmente', () => {
    expect(isSamePhone('abc', 'abc')).toBe(true);
    expect(isSamePhone('abc', 'abd')).toBe(false);
  });
});

describe('phoneLookupVariants (compatibilidad de búsqueda)', () => {
  it('incluye la forma canónica, la cruda y la de solo dígitos', () => {
    const variantes = phoneLookupVariants('+573001112233');

    expect(variantes).toContain('+573001112233');
    expect(variantes).toContain('573001112233');
  });

  it('incluye la forma nacional, por si se guardó sin indicativo', () => {
    expect(phoneLookupVariants('+573001112233')).toContain('3001112233');
  });

  it('buscar sin "+" encuentra las mismas variantes que buscar con "+"', () => {
    // Requisito explícito de la migración: la búsqueda no puede romperse
    // mientras el backfill no haya pasado por todos los contactos.
    const conPlus = phoneLookupVariants('+573001112233').sort();
    const sinPlus = phoneLookupVariants('573001112233').sort();

    expect(sinPlus).toEqual(expect.arrayContaining(conPlus));
  });

  it('no devuelve duplicados', () => {
    const variantes = phoneLookupVariants('573001112233');

    expect(new Set(variantes).size).toBe(variantes.length);
  });

  it('devuelve lista vacía para una entrada vacía', () => {
    expect(phoneLookupVariants('')).toEqual([]);
  });
});
