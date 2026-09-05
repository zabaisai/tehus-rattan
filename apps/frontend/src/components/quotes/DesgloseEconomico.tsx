'use client';

import type { Quote } from '@/types';
import { formatearDinero } from '@/lib/dinero';

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
 *
 * SIGUE LAS MISMAS REGLAS QUE `quote-desglose.ts` DEL BACKEND, que es el
 * contrato del que sale el PDF. No se puede importar —son dos aplicaciones—,
 * así que la garantía es una prueba de paridad que compara las dos listas para
 * los mismos datos. En staging, tres listas escritas a mano produjeron un PDF
 * que no cuadraba con la pantalla.
 */
export function filasDelDesglose(
  quote: Quote,
): Array<{ label: string; value: number; emphasize?: boolean; informativa?: boolean }> {
  // SE PARTE DEL BRUTO Y SE RESTA, igual que en el servidor.
  //
  // `subtotal` ya lleva descontados los descuentos de línea; enseñarlo como
  // primera fila y ADEMÁS restarlos los contaría dos veces. Partir del bruto
  // deja todas las filas sumables, que es lo que permite cuadrar el documento
  // a mano.
  const bruto = quote.subtotal + quote.lineDiscountTotal;

  const filas: Array<{
    label: string;
    value: number;
    emphasize?: boolean;
    informativa?: boolean;
  }> = [
    {
      label: quote.lineDiscountTotal > 0 ? 'Subtotal bruto' : 'Subtotal',
      value: bruto,
    },
  ];

  // Solo se enseña lo que tiene valor. Una lista con cinco ceros esconde las
  // dos cifras que de verdad importan.
  if (quote.lineDiscountTotal > 0) {
    filas.push({ label: 'Descuentos por línea', value: -quote.lineDiscountTotal });
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
    const tasa = Number.isInteger(quote.taxRate)
      ? String(quote.taxRate)
      : String(quote.taxRate).replace('.', ',');
    filas.push(
      quote.taxIncluded
        ? {
            // Con impuesto incluido el total NO cambia: ya está dentro de los
            // precios. Sumarlo otra vez desviaría la pantalla un 19 % entero.
            label: `IVA ${tasa}% incluido en los precios`,
            value: quote.taxTotal,
            informativa: true,
          }
        : { label: `IVA ${tasa}%`, value: quote.taxTotal },
    );
  }

  filas.push({ label: 'Total', value: quote.total, emphasize: true });
  return filas;
}

interface Props {
  quote: Quote;
  /**
   * Formato de dinero de la empresa. Se recibe por propiedad para que este
   * componente siga siendo presentacional y no consulte nada por su cuenta.
   */
  formato?: (valor: number) => string;
}

export default function DesgloseEconomico({
  quote,
  formato = formatearDinero,
}: Props) {
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
            {formato(fila.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
