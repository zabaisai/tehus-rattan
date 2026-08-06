import { Prisma } from '@prisma/client';
import {
  type Dinero,
  dinero,
  suma,
  resta,
  multiplica,
  porcentajeDe,
  redondea,
  noNegativo,
  mayorQue,
} from '../../common/dinero/dinero';

/**
 * EL CALCULO DE UNA COTIZACION. El servidor es la autoridad.
 *
 * El navegador puede calcular para que el usuario vea el total al instante,
 * pero lo que se guarda sale de aqui: un total que llega del cliente es un
 * total que el cliente puede cambiar.
 *
 * EL ORDEN IMPORTA y es esta:
 *
 *   1. linea = cantidad x precio unitario
 *   2. linea -= descuento de linea
 *   3. subtotal = suma de lineas
 *   4. subtotal -= descuento general
 *   5. += transporte
 *   6. += ajuste (que puede ser negativo)
 *   7. impuesto sobre lo anterior
 *
 * Cambiar el orden cambia el total. El transporte va DESPUES del descuento
 * general porque un «10 % de descuento» se pacta sobre la mercancia, no sobre
 * el flete; y el impuesto va al final porque grava tambien el transporte.
 */

export interface LineaDeCotizacion {
  quantity: number;
  unitPrice: Prisma.Decimal.Value;
  /** Importe ya calculado. Si viene porcentaje, se resuelve antes. */
  lineDiscount?: Prisma.Decimal.Value;
  lineDiscountPercent?: Prisma.Decimal.Value | null;
}

export interface EntradaDeCalculo {
  lineas: LineaDeCotizacion[];
  /** Descuento general, como importe. */
  discount?: Prisma.Decimal.Value;
  shipping?: Prisma.Decimal.Value;
  /** Positivo o negativo. */
  adjustment?: Prisma.Decimal.Value;
  /** En unidades humanas: 19 significa 19 %. */
  taxRate?: Prisma.Decimal.Value;
  /** Si el precio unitario YA lleva el impuesto dentro. */
  taxIncluded?: boolean;
  /** Decimales a los que redondear. Los de la empresa. */
  roundingDecimals?: number;
}

export interface LineaCalculada {
  /** `cantidad x precio`, antes del descuento. */
  bruto: Dinero;
  descuento: Dinero;
  /** `bruto - descuento`. Sin impuesto. */
  subtotal: Dinero;
}

export interface TotalesDeCotizacion {
  lineas: LineaCalculada[];
  /** Suma de las líneas, ya con sus descuentos aplicados. */
  subtotal: Dinero;
  lineDiscountTotal: Dinero;
  discount: Dinero;
  shipping: Dinero;
  adjustment: Dinero;
  /** Base sobre la que se calcula el impuesto. */
  baseImponible: Dinero;
  taxTotal: Dinero;
  total: Dinero;
}

export function calcularCotizacion(
  entrada: EntradaDeCalculo,
): TotalesDeCotizacion {
  const decimales = entrada.roundingDecimals ?? 0;
  const r = (v: Prisma.Decimal.Value) => redondea(v, decimales);

  // ── 1 y 2: cada línea con su descuento ────────────────────────
  const lineas: LineaCalculada[] = entrada.lineas.map((l) => {
    const bruto = multiplica(l.quantity, l.unitPrice);

    // El porcentaje se resuelve AQUÍ y una sola vez. Guardar la regla en vez
    // del importe haría que dos recálculos dieran cifras distintas por
    // redondeo, y un cliente que compara dos impresiones lo notaría.
    const porPorcentaje =
      l.lineDiscountPercent !== null && l.lineDiscountPercent !== undefined
        ? porcentajeDe(bruto, l.lineDiscountPercent)
        : null;

    const pedido = porPorcentaje ?? dinero(l.lineDiscount ?? 0);
    // Un descuento mayor que la línea no regala dinero: se acota.
    const descuento = r(mayorQue(pedido, bruto) ? bruto : pedido);

    return {
      bruto: r(bruto),
      descuento,
      subtotal: r(noNegativo(resta(bruto, descuento))),
    };
  });

  const lineDiscountTotal = r(suma(...lineas.map((l) => l.descuento)));
  const subtotal = r(suma(...lineas.map((l) => l.subtotal)));

  // ── 4: descuento general ──────────────────────────────────────
  const pedidoGeneral = dinero(entrada.discount ?? 0);
  // Se acota al subtotal en vez de recortar solo el total: así lo que queda
  // registrado como descuento es lo que de verdad se aplicó, y no una cifra
  // que el documento no refleja.
  const discount = r(
    mayorQue(pedidoGeneral, subtotal) ? subtotal : noNegativo(pedidoGeneral),
  );

  // ── 5 y 6: transporte y ajuste ────────────────────────────────
  const shipping = r(noNegativo(entrada.shipping ?? 0));
  // El ajuste SÍ puede ser negativo: un redondeo comercial a la baja es tan
  // legítimo como un recargo.
  const adjustment = r(entrada.adjustment ?? 0);

  const baseBruta = suma(resta(subtotal, discount), shipping, adjustment);
  const base = r(noNegativo(baseBruta));

  // ── 7: impuesto ───────────────────────────────────────────────
  const tasa = dinero(entrada.taxRate ?? 0);
  let taxTotal: Dinero;
  let baseImponible: Dinero;
  let total: Dinero;

  if (tasa.isZero()) {
    taxTotal = r(0);
    baseImponible = base;
    total = base;
  } else if (entrada.taxIncluded) {
    // IVA INCLUIDO: el impuesto se EXTRAE de la base, no se suma encima.
    //
    // base = neto x (1 + tasa/100)  =>  neto = base / (1 + tasa/100)
    //
    // Confundir esto con «sumar el 19 %» desvía el total un 19 % entero, que
    // es el error más caro que puede tener una cotización.
    const factor = dinero(1).plus(dinero(tasa).dividedBy(100));
    const neto = dinero(base).dividedBy(factor);
    baseImponible = r(neto);
    taxTotal = r(resta(base, baseImponible));
    total = base;
  } else {
    // IVA ADICIONAL: se suma encima.
    baseImponible = base;
    taxTotal = r(porcentajeDe(base, tasa));
    total = r(suma(base, taxTotal));
  }

  return {
    lineas,
    subtotal,
    lineDiscountTotal,
    discount,
    shipping,
    adjustment,
    baseImponible,
    taxTotal,
    total: r(noNegativo(total)),
  };
}
