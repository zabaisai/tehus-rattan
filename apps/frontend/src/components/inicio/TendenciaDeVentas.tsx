'use client';

import { SalesTrend } from '@/types';

/**
 * «Tendencia de ventas» del mockup 01, con el dato que de verdad existe.
 *
 * QUÉ DIBUJA, Y POR QUÉ NO ES LO MISMO QUE EL MOCKUP. El mockup dibuja
 * «Ganado» y «Proyectado». Lo proyectado exige un pronóstico —probabilidad por
 * etapa, ponderación, un modelo— que este producto no calcula; dibujar una
 * línea discontinua inventada en el panel donde alguien decide si el mes va
 * bien es exactamente el tipo de dato falso que el plan prohíbe. Aquí van dos
 * series REALES: oportunidades **abiertas** y **ganadas** por día.
 *
 * SVG a mano y no una librería de gráficos: son dos polilíneas sin ejes
 * interactivos, y añadir una dependencia de 40 kB al Inicio para esto sería
 * peor negocio que treinta líneas de `path`.
 *
 * ACCESIBILIDAD. El dibujo va `aria-hidden` y debajo hay una tabla real con
 * los mismos números. Un gráfico que solo existe como píxeles no está para
 * quien usa lector de pantalla, y resumirlo en un `aria-label` de una frase
 * obliga a confiar en el resumen en vez de leer el dato.
 */
export function TendenciaDeVentas({
  datos,
  formatoDinero,
}: {
  datos: SalesTrend;
  formatoDinero: (v: number) => string;
}) {
  const { points } = datos;

  const maximo = Math.max(
    1,
    ...points.map((p) => Math.max(p.openedValue, p.wonValue)),
  );

  const ANCHO = 640;
  const ALTO = 160;
  const x = (i: number) =>
    points.length <= 1 ? 0 : (i / (points.length - 1)) * ANCHO;
  const y = (v: number) => ALTO - (v / maximo) * (ALTO - 8) - 4;

  const camino = (clave: 'openedValue' | 'wonValue') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[clave]).toFixed(1)}`)
      .join(' ');

  const hayMovimiento = points.some((p) => p.openedValue > 0 || p.wonValue > 0);

  // Cuatro marcas de fecha como mucho: con treinta días, una etiqueta por
  // punto se convierte en una mancha ilegible.
  const marcas = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 3) === 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Leyenda color="bg-brand-primary" texto="Abiertas" />
        <Leyenda color="bg-status-success" texto="Ganadas" />
        <span className="ml-auto font-mono text-xs tabular-nums text-content-secondary">
          {datos.days} días
        </span>
      </div>

      {!hayMovimiento ? (
        // Estado honesto: la serie llegó, y está en cero. Es distinto de «no
        // pude cargar» y distinto de dibujar una recta que parezca un dato.
        <p className="py-8 text-center text-sm text-content-secondary">
          Sin movimiento en los últimos {datos.days} días. Cuando se abran o se
          ganen oportunidades, la curva aparece aquí.
        </p>
      ) : (
        <>
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox={`0 0 ${ANCHO} ${ALTO}`}
            preserveAspectRatio="none"
            className="h-40 w-full"
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={0}
                x2={ANCHO}
                y1={ALTO * f}
                y2={ALTO * f}
                className="stroke-line-default"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={camino('openedValue')}
              fill="none"
              className="stroke-brand-primary"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={camino('wonValue')}
              fill="none"
              className="stroke-status-success"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div
            aria-hidden="true"
            className="flex justify-between font-mono text-[10px] tabular-nums text-content-secondary"
          >
            {marcas.map(({ p }) => (
              <span key={p.date}>{p.date.slice(5)}</span>
            ))}
          </div>
        </>
      )}

      {/* El mismo dato en texto. Es lo que lee un lector de pantalla y lo que
          permite comprobar una cifra sin medir píxeles. */}
      <table className="w-full text-xs">
        <caption className="sr-only">
          Valor de las oportunidades abiertas y ganadas por día, en los últimos{' '}
          {datos.days} días
        </caption>
        <tbody>
          <tr className="border-t border-line-default">
            <th scope="row" className="py-2 text-left font-medium text-content-secondary">
              Abiertas
            </th>
            <td className="py-2 text-right font-mono tabular-nums text-content-primary">
              {datos.totals.openedCount} · {formatoDinero(datos.totals.openedValue)}
            </td>
          </tr>
          <tr className="border-t border-line-default">
            <th scope="row" className="py-2 text-left font-medium text-content-secondary">
              Ganadas
            </th>
            <td className="py-2 text-right font-mono tabular-nums text-content-primary">
              {datos.totals.wonCount} · {formatoDinero(datos.totals.wonValue)}
            </td>
          </tr>
        </tbody>
      </table>

      {datos.wonWithoutDate > 0 && (
        // No se reparten ni se empujan al último día: se dicen.
        <p className="text-[11px] text-content-secondary">
          {datos.wonWithoutDate}{' '}
          {datos.wonWithoutDate === 1 ? 'venta no aparece' : 'ventas no aparecen'} en
          la curva: no tienen registro de cambio de etapa con el que fecharlas.
        </p>
      )}
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-content-secondary">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />
      {texto}
    </span>
  );
}
