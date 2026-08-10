import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DesgloseEconomico, { filasDelDesglose } from './DesgloseEconomico';
import type { Quote } from '@/types';

/**
 * EL DESGLOSE QUE VE QUIEN COTIZA.
 *
 * Antes la pantalla enseñaba subtotal, descuento y total, y el documento
 * imprimible añadia un «Abono» fijo a cero que no existe en el modelo. Con
 * transporte, impuesto y ajuste ya alcanzables desde la API, dos listas
 * escritas a mano habrian acabado diciendo cifras distintas del mismo
 * documento.
 *
 * Aqui se comprueba tambien lo que NUNCA debe aparecer: `$ NaN`. Ya paso una
 * vez, cuando los importes salian por la API como la representacion interna de
 * un Decimal.
 */
const formatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const base: Quote = {
  id: 'q1',
  number: 'COT-0001',
  title: 'Sala de ratán',
  status: 'DRAFT',
  subtotal: 500000,
  lineDiscountTotal: 0,
  discount: 0,
  shipping: 0,
  adjustment: 0,
  adjustmentLabel: null,
  taxRate: 0,
  taxTotal: 0,
  taxIncluded: false,
  currency: 'COP',
  roundingDecimals: 0,
  total: 500000,
  notes: null,
  validUntil: null,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  leadId: 'l1',
  companyId: 'c1',
  createdById: null,
  lead: { id: 'l1', title: 'Cliente', status: 'OPEN' },
  items: [],
};

describe('Desglose económico de una cotización', () => {
  it('con todo a cero solo enseña subtotal y total', () => {
    // Una lista con cinco ceros esconde las dos cifras que importan.
    const etiquetas = filasDelDesglose(base).map((f) => f.label);
    expect(etiquetas).toEqual(['Subtotal', 'Total']);
  });

  it('enseña cada concepto que tiene valor, en orden', () => {
    const etiquetas = filasDelDesglose({
      ...base,
      subtotal: 400000,
      lineDiscountTotal: 100000,
      discount: 25000,
      shipping: 50000,
      adjustment: -15000,
      adjustmentLabel: 'Rebaja acordada',
      taxRate: 19,
      taxTotal: 77900,
      total: 487900,
    }).map((f) => f.label);

    expect(etiquetas).toEqual([
      'Subtotal bruto',
      'Descuentos por línea',
      'Descuento general',
      'Transporte',
      'Rebaja acordada',
      'IVA 19%',
      'Total',
    ]);
  });

  /**
   * EL CASO EXACTO DE STAGING, EN LA PANTALLA.
   *
   * Lo que se comprueba no es que aparezcan los conceptos, sino que quien mire
   * la pantalla pueda SUMAR lo que ve y llegar al total. El PDF tiene su propia
   * prueba con la misma exigencia, y las etiquetas de ambos coinciden.
   */
  it('el desglose de la pantalla suma el total (caso de staging)', () => {
    const filas = filasDelDesglose({
      ...base,
      subtotal: 400000,
      lineDiscountTotal: 100000,
      discount: 25000,
      shipping: 50000,
      adjustment: -15000,
      adjustmentLabel: 'QA_HOTFIX_ rebaja',
      taxRate: 19,
      taxTotal: 77900,
      total: 487900,
    });

    const suma = filas
      .filter((f) => !f.emphasize && !f.informativa)
      .reduce((acc, f) => acc + f.value, 0);

    expect(suma).toBe(487900);
    expect(filas.find((f) => f.emphasize)!.value).toBe(487900);
  });

  it('con IVA incluido la fila es informativa y no altera el total', () => {
    const filas = filasDelDesglose({
      ...base,
      taxRate: 19,
      taxTotal: 79832,
      taxIncluded: true,
      total: 500000,
    });
    const iva = filas.find((f) => f.label.includes('IVA'))!;

    expect(iva.informativa).toBe(true);
    const suma = filas
      .filter((f) => !f.emphasize && !f.informativa)
      .reduce((acc, f) => acc + f.value, 0);
    expect(suma).toBe(500000);
  });

  it('los descuentos se pintan como resta', () => {
    const filas = filasDelDesglose({
      ...base,
      discount: 25000,
      lineDiscountTotal: 10000,
    });
    expect(filas.find((f) => f.label === 'Descuento general')?.value).toBe(
      -25000,
    );
    expect(filas.find((f) => f.label === 'Descuentos por línea')?.value).toBe(
      -10000,
    );
  });

  it('dice si el IVA va incluido o encima', () => {
    // Es la diferencia entre cobrar el 19 % o no cobrarlo: en el papel tiene
    // que quedar escrito.
    expect(
      filasDelDesglose({ ...base, taxRate: 19, taxTotal: 19000, taxIncluded: true })
        .map((f) => f.label)
        .join(' '),
    ).toContain('incluido');
    expect(
      filasDelDesglose({ ...base, taxRate: 19, taxTotal: 19000 })
        .map((f) => f.label)
        .join(' '),
    ).not.toContain('incluido');
  });

  it('un ajuste NEGATIVO se enseña, con su concepto si lo tiene', () => {
    const filas = filasDelDesglose({
      ...base,
      adjustment: -15000,
      adjustmentLabel: 'Rebaja acordada',
    });
    const ajuste = filas.find((f) => f.label === 'Rebaja acordada');
    expect(ajuste?.value).toBe(-15000);
  });

  it('sin concepto, el ajuste se llama «Ajuste»', () => {
    const filas = filasDelDesglose({ ...base, adjustment: -15000 });
    expect(filas.some((f) => f.label === 'Ajuste')).toBe(true);
  });

  it('pinta los importes en COP y NUNCA «$ NaN»', () => {
    render(
      <DesgloseEconomico
        quote={{
          ...base,
          shipping: 50000,
          taxRate: 19,
          taxTotal: 100700,
          total: 630700,
        }}
        formatter={formatter}
      />,
    );

    expect(screen.getByText('Total')).toBeTruthy();
    expect(document.body.textContent).not.toContain('NaN');
    // El formato COP separa miles; comprobamos que el total sale escrito.
    expect(document.body.textContent).toContain('630');
  });

  it('el total se destaca y va el último', () => {
    const filas = filasDelDesglose({ ...base, shipping: 1000, total: 501000 });
    expect(filas[filas.length - 1].label).toBe('Total');
    expect(filas[filas.length - 1].emphasize).toBe(true);
  });

  it('no inventa un «Abono» que no existe en el modelo', () => {
    expect(
      filasDelDesglose(base).some((f) => /abono/i.test(f.label)),
    ).toBe(false);
  });
});
