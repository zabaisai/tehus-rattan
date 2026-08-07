'use client';

import type { Quote } from '@/types';

/**
 * EL DESGLOSE DE UNA COTIZACIÓN, EN UN SOLO SITIO.
 *
 * La pantalla de detalle y el documento imprimible enseñaban cada uno lo suyo:
 * uno mostraba subtotal, descuento y total; el otro añadía un «Abono» fijo a
 * cero que no existe en el modelo. Con los conceptos nuevos —transporte,
 * impuesto, ajuste— dos listas escritas a mano habrían acabado enseñando cifras
 * distintas del mismo documento, que es la peor manera de perder la confianza
 * en un total.
 *
 * TODAS LAS CIFRAS VIENEN DEL SERVIDOR. Aquí no se calcula nada: el backend es
 * la autoridad del total y esto solo lo pinta. Si esta función sumara por su
 * cuenta, tarde o temprano diría algo distinto del PDF.
 */
export function filasDelDesglose(
  quote: Quote,
): Array<{ label: string; value: number; emphasize?: boolean }> {
  const filas: Array<{ label: string; value: number; emphasize?: boolean }> = [
    { label: 'Subtotal', value: quote.subtotal },
  ];

  // Solo se enseña lo que tiene valor. Una lista con cinco ceros esconde las
  // dos cifras que de verdad importan.
  if (quote.lineDiscountTotal > 0) {
    filas.push({
      label: 'Descuentos por línea',
      value: -quote.lineDiscountTotal,
    });
  }
  if (quote.discount > 0) {
    filas.push({ label: 'Descuento general', value: -quote.discount });
  }
  if (quote.shipping > 0) {
    filas.push({ label: 'Transporte', value: quote.shipping });
  }
  if (quote.adjustment !== 0) {
    filas.push({
      label: quote.adjustmentLabel?.trim() || 'Ajuste',
      value: quote.adjustment,
    });
  }
  if (quote.taxRate > 0) {
    filas.push({
      // Se dice si va incluido o encima: es la diferencia entre cobrar el
      // 19 % o no cobrarlo, y en el papel tiene que quedar escrito.
      label: quote.taxIncluded
        ? `IVA ${quote.taxRate}% (incluido)`
        : `IVA ${quote.taxRate}%`,
      value: quote.taxTotal,
    });
  }

  filas.push({ label: 'Total', value: quote.total, emphasize: true });
  return filas;
}

interface Props {
  quote: Quote;
  formatter: Intl.NumberFormat;
}

export default function DesgloseEconomico({ quote, formatter }: Props) {
  return (
    <dl className="mt-3 space-y-1 text-sm">
      {filasDelDesglose(quote).map((fila) => (
        <div
          key={fila.label}
          className={
            fila.emphasize
              ? 'flex justify-between border-t border-neutral-200 pt-1.5 text-base font-semibold'
              : 'flex justify-between'
          }
        >
          <dt className={fila.emphasize ? 'text-neutral-900' : 'text-neutral-500'}>
            {fila.label}
          </dt>
          <dd className={fila.emphasize ? 'text-neutral-900' : 'text-neutral-800'}>
            {formatter.format(fila.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
