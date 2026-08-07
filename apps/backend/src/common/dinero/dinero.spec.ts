import {
  dinero,
  suma,
  resta,
  multiplica,
  porcentajeDe,
  redondea,
  noNegativo,
  mayorQue,
  aNumeroParaMostrar,
} from './dinero';

/**
 * EL DINERO NO ES COMA FLOTANTE.
 *
 * Cada una de estas pruebas falla si alguien vuelve a operar importes con
 * `number`. No comprueban una libreria: comprueban que el producto no vuelva a
 * enseñar un total que no cuadra con la suma de sus partes.
 */
describe('Aritmética de dinero', () => {
  it('0,1 + 0,2 da 0,3 exacto (con `number` da 0.30000000000000004)', () => {
    // Esta es LA razón de que exista este módulo.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(suma(0.1, 0.2).toString()).toBe('0.3');
  });

  it('mil líneas de 0,1 suman exactamente 100', () => {
    const lineas = Array.from({ length: 1000 }, () => 0.1);

    // Con `number` el resultado es 99.9999999999986.
    const conNumber = lineas.reduce((a, b) => a + b, 0);
    expect(conNumber).not.toBe(100);

    expect(suma(...lineas).toString()).toBe('100');
  });

  it('el total cuadra con la suma de sus partes', () => {
    // Un caso realista: tres líneas con precios que en binario no son exactos.
    const lineas = [
      { cantidad: 3, precio: '19.99' },
      { cantidad: 7, precio: '4.35' },
      { cantidad: 11, precio: '0.07' },
    ];

    const subtotales = lineas.map((l) => multiplica(l.cantidad, l.precio));
    const total = suma(...subtotales);

    expect(subtotales.map((s) => s.toString())).toEqual([
      '59.97',
      '30.45',
      '0.77',
    ]);
    expect(total.toString()).toBe('91.19');
  });

  it('un porcentaje va en unidades humanas: 19 es 19 %', () => {
    // Escribir 0,19 donde va 19 es el error clásico; la división por 100 vive
    // dentro de la función precisamente para que no se pueda cometer aquí.
    expect(porcentajeDe(100, 19).toString()).toBe('19');
    expect(porcentajeDe('1000000', 19).toString()).toBe('190000');
  });

  it('redondea la mitad HACIA ARRIBA, que es lo que espera una factura', () => {
    // El modo por defecto de IEEE 754 es «la mitad al par»: 2.5 -> 2, y eso
    // sorprende a cualquiera que mire un recibo.
    expect(redondea('2.345').toString()).toBe('2.35');
    expect(redondea('2.355').toString()).toBe('2.36');
    expect(redondea('0.005').toString()).toBe('0.01');
  });

  it('nunca deja un total por debajo de cero', () => {
    expect(noNegativo(resta(100, 250)).toString()).toBe('0');
    expect(noNegativo(resta(250, 100)).toString()).toBe('150');
  });

  it('trata null y undefined como cero, no como NaN', () => {
    // Un importe ausente es cero. Con `number`, `undefined + 1` es NaN y el
    // NaN se propaga hasta el total sin que nadie lo note.
    expect(suma(null, 5, undefined).toString()).toBe('5');
    expect(dinero(null).toString()).toBe('0');
  });

  it('compara importes sin pasar por coma flotante', () => {
    expect(mayorQue('0.3', suma(0.1, 0.2))).toBe(false);
    expect(mayorQue('0.31', suma(0.1, 0.2))).toBe(true);
  });

  it('solo se convierte a número al final, para mostrarlo', () => {
    expect(aNumeroParaMostrar(suma('19.99', '0.01'))).toBe(20);
    expect(aNumeroParaMostrar(null)).toBe(0);
  });

  it('aguanta importes grandes sin perder precisión', () => {
    // 11.700.000 pesos por 137 unidades: con `number` sigue siendo exacto,
    // pero con céntimos de por medio deja de serlo.
    expect(multiplica('11700000.55', 137).toString()).toBe('1602900075.35');
  });
});
