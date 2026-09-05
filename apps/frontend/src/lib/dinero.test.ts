import { describe, expect, it } from 'vitest';
import {
  REGION_POR_DEFECTO,
  formatearDinero,
  formatearDineroAbreviado,
  formateadorDe,
} from './dinero';

/** Quita los espacios raros que mete `Intl` para comparar sin sorpresas. */
function limpio(texto: string): string {
  return texto.replace(/ | /g, ' ');
}

describe('formatearDinero', () => {
  it('usa la moneda y el idioma de la empresa, no unos fijos', () => {
    const enPesos = limpio(formatearDinero(1500, REGION_POR_DEFECTO));
    const enEuros = limpio(
      formatearDinero(1500, { currency: 'EUR', locale: 'es-ES' }),
    );
    const enDolares = limpio(
      formatearDinero(1500, { currency: 'USD', locale: 'en-US' }),
    );

    expect(enPesos).toContain('1.500');
    expect(enEuros).toContain('€');
    expect(enDolares).toContain('$1,500');
    // Cada empresa ve su moneda: las tres cadenas son distintas.
    expect(new Set([enPesos, enEuros, enDolares]).size).toBe(3);
  });

  it('sin región usa la del producto', () => {
    expect(formatearDinero(1500)).toBe(formatearDinero(1500, REGION_POR_DEFECTO));
  });

  it('nunca escribe NaN: los valores ausentes valen cero', () => {
    for (const valor of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const salida = formatearDinero(valor);
      expect(salida).not.toContain('NaN');
      expect(salida).toBe(formatearDinero(0));
    }
  });

  it('ante una moneda inválida muestra el código y el importe en vez de romperse', () => {
    const salida = formatearDinero(1500, {
      currency: 'INVENTADA',
      locale: 'es-CO',
    });

    expect(salida).toContain('INVENTADA');
    expect(salida).toContain('1500');
  });

  it('ante un idioma inválido tampoco lanza', () => {
    expect(() =>
      formatearDinero(10, { currency: 'COP', locale: 'no es un idioma' }),
    ).not.toThrow();
  });

  it('formateadorDe devuelve nulo cuando la región no es utilizable', () => {
    expect(formateadorDe({ currency: 'NOPE', locale: 'es-CO' })).toBeNull();
    expect(formateadorDe(REGION_POR_DEFECTO)).not.toBeNull();
  });
});

describe('formatearDineroAbreviado', () => {
  it('por debajo del millón escribe el importe entero', () => {
    expect(formatearDineroAbreviado(999_999)).toBe(formatearDinero(999_999));
  });

  it('a partir del millón abrevia, con el símbolo de la empresa', () => {
    const pesos = limpio(formatearDineroAbreviado(27_600_000));
    const dolares = limpio(
      formatearDineroAbreviado(27_600_000, {
        currency: 'USD',
        locale: 'en-US',
      }),
    );

    // Abreviado: mucho más corto que el importe completo.
    expect(pesos.length).toBeLessThan(
      limpio(formatearDinero(27_600_000)).length,
    );
    expect(pesos).toContain('27');
    expect(dolares).toContain('27');
    expect(pesos).not.toContain('NaN');
  });

  it('los negativos se abrevian igual y conservan el signo', () => {
    const salida = limpio(formatearDineroAbreviado(-5_000_000));
    expect(salida).toContain('-');
    expect(salida).toContain('5');
  });

  it('con una moneda inválida cae al importe completo en vez de fallar', () => {
    const salida = formatearDineroAbreviado(3_000_000, {
      currency: 'INVENTADA',
      locale: 'es-CO',
    });
    expect(salida).toContain('INVENTADA');
    expect(salida).not.toContain('NaN');
  });

  it('el cero no se abrevia', () => {
    expect(formatearDineroAbreviado(0)).toBe(formatearDinero(0));
  });
});
