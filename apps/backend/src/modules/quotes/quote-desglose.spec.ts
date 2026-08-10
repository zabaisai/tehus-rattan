import {
  desgloseCuadra,
  filasDeDesglose,
  type EconomiaDeCotizacion,
} from './quote-desglose';

/**
 * EL CONTRATO ECONOMICO, PROBADO EN UN SOLO SITIO.
 *
 * Aqui se fija QUE conceptos aparecen, en que orden y con que signo. El PDF y
 * la pantalla se limitan a pintarlo. Tener esa decision escrita a mano en cada
 * superficie es lo que produjo en staging un documento donde 400.000 - 25.000
 * daba 487.900.
 */
const base: EconomiaDeCotizacion = {
  subtotal: 500_000,
  lineDiscountTotal: 0,
  discount: 0,
  shipping: 0,
  adjustment: 0,
  adjustmentLabel: null,
  taxRate: 0,
  taxTotal: 0,
  taxIncluded: false,
  total: 500_000,
};

const etiquetas = (e: EconomiaDeCotizacion) =>
  filasDeDesglose(e).map((f) => f.etiqueta);

/** La propiedad que hace defendible el documento. */
const cuadra = (e: EconomiaDeCotizacion) => desgloseCuadra(filasDeDesglose(e));

describe('Desglose económico', () => {
  describe('qué filas aparecen', () => {
    it('sin transporte, impuesto ni ajuste: solo subtotal y total', () => {
      // Una lista con cinco ceros esconde las dos cifras que importan.
      expect(etiquetas(base)).toEqual(['Subtotal', 'TOTAL']);
      expect(cuadra(base)).toBe(true);
    });

    it('el caso completo, en el orden en que se aplican las operaciones', () => {
      const e: EconomiaDeCotizacion = {
        ...base,
        subtotal: 400_000,
        lineDiscountTotal: 100_000,
        discount: 25_000,
        shipping: 50_000,
        adjustment: -15_000,
        adjustmentLabel: 'Rebaja acordada',
        taxRate: 19,
        taxTotal: 77_900,
        total: 487_900,
      };

      expect(etiquetas(e)).toEqual([
        'Subtotal bruto',
        'Descuentos por línea',
        'Descuento general',
        'Transporte',
        'Rebaja acordada',
        'IVA 19%',
        'TOTAL',
      ]);
      expect(cuadra(e)).toBe(true);
    });
  });

  describe('signos', () => {
    it('los descuentos restan', () => {
      const f = filasDeDesglose({ ...base, discount: 25_000, total: 475_000 });
      expect(f.find((x) => x.etiqueta === 'Descuento general')!.valor).toBe(
        -25_000,
      );
    });

    it('el transporte suma', () => {
      const f = filasDeDesglose({ ...base, shipping: 50_000, total: 550_000 });
      expect(f.find((x) => x.etiqueta === 'Transporte')!.valor).toBe(50_000);
    });

    it('un ajuste POSITIVO suma', () => {
      const e = { ...base, adjustment: 20_000, total: 520_000 };
      expect(
        filasDeDesglose(e).find((x) => x.etiqueta === 'Ajuste')!.valor,
      ).toBe(20_000);
      expect(cuadra(e)).toBe(true);
    });

    it('un ajuste NEGATIVO resta', () => {
      const e = { ...base, adjustment: -20_000, total: 480_000 };
      expect(
        filasDeDesglose(e).find((x) => x.etiqueta === 'Ajuste')!.valor,
      ).toBe(-20_000);
      expect(cuadra(e)).toBe(true);
    });
  });

  describe('etiqueta del ajuste', () => {
    it('se usa cuando la hay', () => {
      expect(
        etiquetas({
          ...base,
          adjustment: -1000,
          adjustmentLabel: 'Redondeo',
          total: 499_000,
        }),
      ).toContain('Redondeo');
    });

    it('sin etiqueta se llama «Ajuste»', () => {
      expect(
        etiquetas({ ...base, adjustment: -1000, total: 499_000 }),
      ).toContain('Ajuste');
    });

    it('una etiqueta de solo espacios no deja el concepto en blanco', () => {
      expect(
        etiquetas({
          ...base,
          adjustment: -1000,
          adjustmentLabel: '   ',
          total: 499_000,
        }),
      ).toContain('Ajuste');
    });
  });

  describe('impuesto', () => {
    it('NO incluido: suma y cuadra', () => {
      const e = { ...base, taxRate: 19, taxTotal: 95_000, total: 595_000 };
      expect(etiquetas(e)).toContain('IVA 19%');
      expect(cuadra(e)).toBe(true);
    });

    /**
     * CON IMPUESTO INCLUIDO EL TOTAL NO CAMBIA.
     *
     * El impuesto ya esta dentro de los precios; sumarlo otra vez desviaria el
     * papel un 19 % entero, que es el error mas caro que puede tener una
     * cotizacion. Por eso la fila es informativa y la etiqueta lo dice.
     */
    it('incluido: es informativa y NO altera el total', () => {
      const e = {
        ...base,
        taxRate: 19,
        taxTotal: 79_832,
        taxIncluded: true,
        total: 500_000,
      };
      const f = filasDeDesglose(e);
      const iva = f.find((x) => x.etiqueta.includes('IVA'))!;

      expect(iva.etiqueta).toMatch(/incluido/i);
      expect(iva.informativa).toBe(true);
      expect(cuadra(e)).toBe(true);
    });

    it('una tasa con decimales se escribe con coma', () => {
      expect(
        etiquetas({ ...base, taxRate: 19.5, taxTotal: 97_500, total: 597_500 }),
      ).toContain('IVA 19,5%');
    });

    it('tasa cero: no aparece', () => {
      expect(etiquetas(base).join(' ')).not.toMatch(/iva/i);
    });
  });

  describe('descuentos', () => {
    it('solo por línea: se parte del bruto', () => {
      const e = {
        ...base,
        subtotal: 400_000,
        lineDiscountTotal: 100_000,
        total: 400_000,
      };
      const f = filasDeDesglose(e);
      expect(f[0].etiqueta).toBe('Subtotal bruto');
      expect(f[0].valor).toBe(500_000);
      expect(cuadra(e)).toBe(true);
    });

    it('los dos descuentos a la vez cuadran', () => {
      const e = {
        ...base,
        subtotal: 400_000,
        lineDiscountTotal: 100_000,
        discount: 50_000,
        total: 350_000,
      };
      expect(cuadra(e)).toBe(true);
    });

    it('sin descuentos de línea la primera fila se llama «Subtotal» a secas', () => {
      expect(filasDeDesglose(base)[0].etiqueta).toBe('Subtotal');
    });
  });

  describe('redondeo', () => {
    it('cuadra con cuatro decimales', () => {
      const e = {
        ...base,
        subtotal: 333_333.3333,
        shipping: 0.3333,
        taxRate: 19,
        taxTotal: 63_333.4266,
        total: 396_667.0932,
      };
      expect(cuadra(e)).toBe(true);
    });

    it('una diferencia de céntimo por redondeo no se considera descuadre', () => {
      const e = { ...base, total: 500_000.005 };
      expect(cuadra(e)).toBe(true);
    });

    it('un descuadre de verdad SÍ se detecta', () => {
      // Es exactamente el caso de staging: faltaban conceptos y el total no
      // se podia reconstruir.
      const f = [
        { etiqueta: 'Subtotal', valor: 400_000 },
        { etiqueta: 'Descuento general', valor: -25_000 },
        { etiqueta: 'TOTAL', valor: 487_900, destacada: true },
      ];
      expect(desgloseCuadra(f)).toBe(false);
    });
  });

  it('el TOTAL siempre va el último y destacado', () => {
    for (const e of [
      base,
      { ...base, shipping: 1000, total: 501_000 },
      { ...base, taxRate: 19, taxTotal: 95_000, total: 595_000 },
    ]) {
      const f = filasDeDesglose(e);
      expect(f.at(-1)!.etiqueta).toBe('TOTAL');
      expect(f.at(-1)!.destacada).toBe(true);
    }
  });
});
