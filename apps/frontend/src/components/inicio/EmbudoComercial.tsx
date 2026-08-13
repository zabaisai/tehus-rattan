'use client';

import Link from 'next/link';
import { LeadsByStage } from '@/types';

/**
 * El embudo del mockup 01: orden, etapa, cuántas y cuánto.
 *
 * NO SE ENSEÑA NINGÚN CÓDIGO TÉCNICO. El `stageId` viaja en el enlace, que es
 * donde sirve, y nunca en pantalla: un `cmsoy6e8g000i…` al lado del nombre de
 * una etapa no le dice nada a quien vende.
 *
 * NO SE INVENTAN NI SE ESCONDEN ETAPAS. Se pintan las que devuelve
 * `analytics/leads-by-stage`, en su orden y con su nombre real, incluidas las
 * que alguien creó mientras probaba. Filtrar «las que parecen de prueba» sería
 * decidir por el usuario qué hay en su propio embudo, y bastaría una etapa
 * legítima con nombre corto para que desapareciera del resumen.
 *
 * EL NÚMERO DE ORDEN ES POSICIONAL, no un dato guardado: es el lugar que
 * ocupa la etapa en la lista que ya viene ordenada por el servidor.
 */
export function EmbudoComercial({
  etapas,
  formatoDinero,
}: {
  etapas: LeadsByStage[];
  formatoDinero: (v: number) => string;
}) {
  const valorMaximo = Math.max(1, ...etapas.map((e) => e.totalValue));
  const totalLeads = etapas.reduce((s, e) => s + e.count, 0);
  const totalValor = etapas.reduce((s, e) => s + e.totalValue, 0);

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {etapas.map((etapa, i) => (
          <li key={etapa.stageId}>
            <Link
              href={`/dashboard/pipeline?etapa=${encodeURIComponent(etapa.stageId)}`}
              aria-label={`${etapa.stageName}: ${etapa.count} oportunidades, ${formatoDinero(etapa.totalValue)}. Abrir el embudo en esta etapa`}
              className="group flex items-center gap-3 rounded-md px-2 py-2 outline-none transition-colors duration-rapida ease-standard hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-primary font-mono text-[11px] font-semibold tabular-nums text-white"
              >
                {String(i + 1).padStart(2, '0')}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-content-primary">
                    {etapa.stageName}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-content-secondary">
                    {etapa.count} {etapa.count === 1 ? 'lead' : 'leads'}
                  </span>
                </span>

                {/* La barra compara valores; la cifra ya está escrita al lado,
                    así que la barra es decorativa para el lector de pantalla. */}
                <span
                  aria-hidden="true"
                  className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
                >
                  <span
                    className="block h-full rounded-full bg-brand-primary transition-[width] duration-lenta ease-standard"
                    style={{
                      width: `${etapa.totalValue > 0 ? Math.max(4, (etapa.totalValue / valorMaximo) * 100) : 0}%`,
                    }}
                  />
                </span>
              </span>

              <span className="w-20 shrink-0 text-right font-mono text-xs font-medium tabular-nums text-content-primary">
                {formatoDinero(etapa.totalValue)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 rounded-md bg-surface-subtle px-3 py-2.5">
        <span className="text-sm font-medium text-content-primary">Total del embudo</span>
        <span className="flex items-baseline gap-3 font-mono text-xs tabular-nums text-content-secondary">
          <span>
            {totalLeads} {totalLeads === 1 ? 'lead' : 'leads'}
          </span>
          <span className="text-sm font-semibold text-content-primary">
            {formatoDinero(totalValor)}
          </span>
        </span>
      </div>
    </div>
  );
}
