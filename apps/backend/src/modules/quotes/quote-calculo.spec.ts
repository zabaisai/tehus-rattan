import { calcularCotizacion } from './quote-calculo';

/** Los importes se comparan por VALOR: un Decimal no es igual a un número. */
const n = (v: unknown) => Number(v);

describe('Cálculo de una cotización', () => {
  it('varios productos con cantidades', () => {
    const r = calcularCotizacion({
      lineas: [
        { quantity: 2, unitPrice: 100 },
        { quantity: 3, unitPrice: 250 },
        { quantity: 1, unitPrice: 1_200 },
      ],
    });

    expect(n(r.subtotal)).toBe(200 + 750 + 1200);
    expect(n(r.total)).toBe(2150);
  });

  it('descuento POR LÍNEA como importe', () => {
    const r = calcularCotizacion({
      lineas: [
        { quantity: 2, unitPrice: 100, lineDiscount: 50 },
        { quantity: 1, unitPrice: 300 },
      ],
    });

    expect(n(r.lineas[0].subtotal)).toBe(150);
    expect(n(r.lineDiscountTotal)).toBe(50);
    expect(n(r.subtotal)).toBe(450);
  });

  it('descuento POR LÍNEA como porcentaje', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 4, unitPrice: 250, lineDiscountPercent: 10 }],
    });

    expect(n(r.lineas[0].bruto)).toBe(1000);
    expect(n(r.lineas[0].descuento)).toBe(100);
    expect(n(r.subtotal)).toBe(900);
  });

  it('un descuento de línea mayor que la línea no regala dinero', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 100, lineDiscount: 500 }],
    });

    expect(n(r.lineas[0].descuento)).toBe(100);
    expect(n(r.lineas[0].subtotal)).toBe(0);
    expect(n(r.total)).toBe(0);
  });

  it('descuento GENERAL sobre el subtotal', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_000 }],
      discount: 150,
    });

    expect(n(r.discount)).toBe(150);
    expect(n(r.total)).toBe(850);
  });

  it('el descuento general se ACOTA al subtotal, no recorta solo el total', () => {
    // Así lo que queda registrado como descuento es lo que de verdad se
    // aplicó, y no una cifra que el documento no refleja.
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 200 }],
      discount: 999,
    });

    expect(n(r.discount)).toBe(200);
    expect(n(r.total)).toBe(0);
  });

  it('transporte: se suma DESPUÉS del descuento general', () => {
    // Un «10 % de descuento» se pacta sobre la mercancía, no sobre el flete.
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_000 }],
      discount: 100,
      shipping: 80,
    });

    expect(n(r.total)).toBe(980);
  });

  it('ajuste NEGATIVO: un redondeo comercial a la baja', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_017 }],
      adjustment: -17,
    });

    expect(n(r.adjustment)).toBe(-17);
    expect(n(r.total)).toBe(1000);
  });

  it('ajuste positivo: un recargo', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_000 }],
      adjustment: 50,
    });

    expect(n(r.total)).toBe(1050);
  });

  // ── impuestos ────────────────────────────────────────────────

  it('IVA ADICIONAL: se suma encima', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_000_000 }],
      taxRate: 19,
    });

    expect(n(r.baseImponible)).toBe(1_000_000);
    expect(n(r.taxTotal)).toBe(190_000);
    expect(n(r.total)).toBe(1_190_000);
  });

  /**
   * IVA INCLUIDO.
   *
   * El impuesto se EXTRAE de la base, no se suma encima. Confundirlo con
   * «sumar el 19 %» desvía el total un 19 % entero: es el error más caro que
   * puede tener una cotización.
   */
  it('IVA INCLUIDO: se extrae de la base y el total NO cambia', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_190_000 }],
      taxRate: 19,
      taxIncluded: true,
    });

    expect(n(r.total)).toBe(1_190_000);
    expect(n(r.baseImponible)).toBe(1_000_000);
    expect(n(r.taxTotal)).toBe(190_000);
  });

  it('IVA incluido y adicional dan totales DISTINTOS con el mismo precio', () => {
    const lineas = [{ quantity: 1, unitPrice: 1_000_000 }];
    const adicional = calcularCotizacion({ lineas, taxRate: 19 });
    const incluido = calcularCotizacion({
      lineas,
      taxRate: 19,
      taxIncluded: true,
    });

    expect(n(adicional.total)).toBe(1_190_000);
    expect(n(incluido.total)).toBe(1_000_000);
  });

  it('el impuesto grava TAMBIÉN el transporte', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 1_000 }],
      shipping: 100,
      taxRate: 19,
    });

    expect(n(r.baseImponible)).toBe(1_100);
    expect(n(r.taxTotal)).toBe(209);
    expect(n(r.total)).toBe(1_309);
  });

  it('sin impuesto, el total es la base', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 500 }],
      taxRate: 0,
    });

    expect(n(r.taxTotal)).toBe(0);
    expect(n(r.total)).toBe(500);
  });

  // ── redondeo ─────────────────────────────────────────────────

  it('redondea a los decimales de la empresa', () => {
    // El peso colombiano no usa centavos: 0 decimales es lo normal.
    const enPesos = calcularCotizacion({
      lineas: [{ quantity: 3, unitPrice: '333.333' }],
      roundingDecimals: 0,
    });
    expect(n(enPesos.subtotal)).toBe(1000);

    const enDolares = calcularCotizacion({
      lineas: [{ quantity: 3, unitPrice: '333.333' }],
      roundingDecimals: 2,
    });
    expect(n(enDolares.subtotal)).toBe(1000);
  });

  it('el redondeo es «la mitad hacia arriba», como en una factura', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: '2.345' }],
      roundingDecimals: 2,
    });
    expect(n(r.total)).toBe(2.35);
  });

  // ── el caso completo ─────────────────────────────────────────

  /**
   * TODO A LA VEZ, que es donde el orden de las operaciones se nota.
   *
   * Cambiar el orden cambia el total, así que esta prueba fija el orden
   * acordado: línea, descuento de línea, subtotal, descuento general,
   * transporte, ajuste, impuesto.
   */
  it('cotización completa: líneas, descuentos, transporte, ajuste e IVA', () => {
    const r = calcularCotizacion({
      lineas: [
        // 2 x 500.000 = 1.000.000, menos 10 % = 900.000
        { quantity: 2, unitPrice: 500_000, lineDiscountPercent: 10 },
        // 3 x 200.000 = 600.000, menos 50.000 = 550.000
        { quantity: 3, unitPrice: 200_000, lineDiscount: 50_000 },
      ],
      discount: 45_000, // sobre 1.450.000 -> 1.405.000
      shipping: 120_000, // -> 1.525.000
      adjustment: -5_000, // -> 1.520.000
      taxRate: 19, // + 288.800
      roundingDecimals: 0,
    });

    expect(n(r.lineas[0].subtotal)).toBe(900_000);
    expect(n(r.lineas[1].subtotal)).toBe(550_000);
    expect(n(r.subtotal)).toBe(1_450_000);
    expect(n(r.lineDiscountTotal)).toBe(150_000);
    expect(n(r.discount)).toBe(45_000);
    expect(n(r.shipping)).toBe(120_000);
    expect(n(r.adjustment)).toBe(-5_000);
    expect(n(r.baseImponible)).toBe(1_520_000);
    expect(n(r.taxTotal)).toBe(288_800);
    expect(n(r.total)).toBe(1_808_800);
  });

  it('el total cuadra con la suma de sus partes', () => {
    // Es la comprobación que un cliente hace con una calculadora.
    const r = calcularCotizacion({
      lineas: [
        { quantity: 7, unitPrice: '19.99' },
        { quantity: 11, unitPrice: '4.35' },
      ],
      shipping: '12.50',
      taxRate: 19,
      roundingDecimals: 2,
    });

    const reconstruido =
      n(r.subtotal) -
      n(r.discount) +
      n(r.shipping) +
      n(r.adjustment) +
      n(r.taxTotal);

    expect(n(r.total)).toBeCloseTo(reconstruido, 2);
  });

  it('nunca devuelve un total negativo', () => {
    const r = calcularCotizacion({
      lineas: [{ quantity: 1, unitPrice: 100 }],
      adjustment: -5_000,
    });

    expect(n(r.total)).toBe(0);
  });

  it('una cotización sin líneas no revienta', () => {
    const r = calcularCotizacion({ lineas: [] });

    expect(n(r.subtotal)).toBe(0);
    expect(n(r.total)).toBe(0);
  });
});
