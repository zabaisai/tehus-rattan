import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { Skeleton } from './Skeleton';

/**
 * Una métrica que lleva a su listado.
 *
 * ACCIONABLE quiere decir exactamente eso: cada cifra es un enlace al sitio
 * donde se actúa sobre ella. Un número suelto informa; un número que abre las
 * cinco tareas vencidas resuelve. Por eso `href` es obligatorio.
 *
 * NO tiene variante «con tendencia». Los mockups dibujan una curva y un
 * «+14 % vs. ayer», pero la API no expone series temporales: pintar una
 * tendencia inventada sería peor que no pintarla, porque la gente decide
 * mirando esa flecha. Cuando exista el dato, entra aquí.
 */
export function MetricCard({
  etiqueta,
  valor,
  icono: Icono,
  href,
  hrefLabel,
  cargando = false,
  tono = 'neutral',
}: {
  etiqueta: string;
  valor: string | number;
  icono: LucideIcon;
  href: string;
  /** Qué se abre. Va al nombre accesible: «Tareas por vencer: 5, abrir tareas». */
  hrefLabel: string;
  cargando?: boolean;
  /** `atencion` para lo que está vencido o pendiente. Nunca decorativo. */
  tono?: 'neutral' | 'atencion';
}) {
  const acento =
    tono === 'atencion'
      ? 'bg-status-warning-surface text-status-warning-strong'
      : 'bg-primary-50 text-brand-primary';

  return (
    <Link
      href={href}
      aria-label={`${etiqueta}: ${cargando ? 'cargando' : valor}. ${hrefLabel}`}
      className="group flex items-start gap-3 rounded-lg border border-line-default bg-surface-default p-4 shadow-xs outline-none transition-colors hover:border-line-strong hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
    >
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${acento}`}
      >
        <Icono size={17} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-content-secondary">
          {etiqueta}
        </span>
        {cargando ? (
          <Skeleton className="mt-1.5 h-7 w-24" />
        ) : (
          // `tabular-nums` en la mono de marca: sin eso, cuatro cifras cambian
          // de ancho al actualizarse y la fila entera baila.
          <span className="mt-0.5 block truncate font-mono text-2xl font-semibold tabular-nums text-content-primary">
            {valor}
          </span>
        )}
      </span>
    </Link>
  );
}
