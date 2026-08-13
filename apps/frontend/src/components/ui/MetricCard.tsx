import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, LucideIcon } from 'lucide-react';
import { Skeleton } from './Skeleton';
import { Sparkline } from './Sparkline';

/**
 * Una métrica que lleva a su listado.
 *
 * ACCIONABLE quiere decir exactamente eso: cada cifra es un enlace al sitio
 * donde se actúa sobre ella. Un número suelto informa; un número que abre las
 * cinco tareas vencidas resuelve. Por eso `href` es obligatorio.
 *
 * LA TENDENCIA ES OPCIONAL Y NUNCA SE INVENTA. `serie` y `comparacion` solo se
 * pasan cuando `analytics/sales-trend` devuelve el dato real para esa métrica.
 * Las métricas que son una foto fija del presente —conversión acumulada,
 * tareas vencidas ahora mismo— se quedan sin flecha, y eso es correcto: una
 * flecha es una afirmación sobre el pasado, y la gente decide mirándola.
 */
export interface ComparacionMetrica {
  /** Ya formateado: «+3» o «+$ 1,2 M». El componente no calcula dinero. */
  texto: string;
  /** Con qué se compara: «vs. 30 días previos». */
  contra: string;
  direccion: 'sube' | 'baja' | 'igual';
  /**
   * `true` si subir es bueno. Las tareas vencidas suben y eso es malo, así que
   * el color no puede salir del signo: sale de esto.
   */
  subirEsBueno?: boolean;
}

export function MetricCard({
  etiqueta,
  valor,
  icono: Icono,
  href,
  hrefLabel,
  cargando = false,
  tono = 'neutral',
  serie,
  comparacion,
  nota,
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
  /** Serie real para la curva. Menos de dos puntos y no se dibuja nada. */
  serie?: number[];
  comparacion?: ComparacionMetrica;
  /** Aclara qué mide la curva cuando la cifra es una foto y la serie un flujo. */
  nota?: string;
}) {
  const acento =
    tono === 'atencion'
      ? 'bg-status-warning-surface text-status-warning-strong'
      : 'bg-primary-50 text-brand-primary';

  const subirEsBueno = comparacion?.subirEsBueno ?? true;
  const esFavorable =
    comparacion?.direccion === 'igual'
      ? null
      : (comparacion?.direccion === 'sube') === subirEsBueno;

  const colorComparacion =
    esFarolNeutro(comparacion) || esFavorable === null
      ? 'text-content-secondary'
      : esFavorable
        ? 'text-status-success-strong'
        : 'text-status-error';

  const FlechaComparacion =
    comparacion?.direccion === 'sube'
      ? ArrowUpRight
      : comparacion?.direccion === 'baja'
        ? ArrowDownRight
        : ArrowRight;

  // El nombre accesible lleva la comparación en palabras: la flecha y el color
  // no existen para quien escucha, y el «+3» suelto no dice contra qué.
  const nombreAccesible = [
    `${etiqueta}: ${cargando ? 'cargando' : valor}`,
    comparacion &&
      `${comparacion.texto} ${comparacion.contra}`,
    hrefLabel,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Link
      href={href}
      aria-label={nombreAccesible}
      className="group flex flex-col gap-3 rounded-lg border border-line-default bg-surface-default p-4 shadow-xs outline-none transition-[color,background-color,border-color,box-shadow,transform] duration-rapida ease-standard hover:-translate-y-px hover:border-line-strong hover:shadow-md focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1 motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-rapida ease-standard ${acento}`}
        >
          <Icono size={17} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-content-secondary">
            {etiqueta}
          </span>
          {cargando ? (
            <Skeleton className="mt-1.5 h-8 w-24" />
          ) : (
            // `tabular-nums` en la mono de marca: sin eso, cuatro cifras
            // cambian de ancho al actualizarse y la fila entera baila.
            // 24 px y no 28: con la curva al lado, a 1440 px la tarjeta deja
            // ~170 px para la cifra y «$ 27,6 M» en mono a 28 px salía
            // cortado. Una métrica truncada es peor que una métrica pequeña.
            <span className="mt-0.5 block truncate font-mono text-2xl font-semibold leading-tight tabular-nums text-content-primary">
              {valor}
            </span>
          )}
        </span>

        {!cargando && serie && serie.length >= 2 && (
          <span
            aria-hidden="true"
            className={`mt-1 shrink-0 ${tono === 'atencion' ? 'text-status-warning-strong' : 'text-primary-400'}`}
          >
            {/* 44 px y no 56: el ancho más apretado NO es 1024 sino **1280**,
                donde `xl` pone las cuatro tarjetas en fila y cada una se queda
                con ~82 px para la cifra. Medido en el navegador: «$ 20 M»
                pedía 86 px y salía cortado por cuatro. */}
            <Sparkline puntos={serie} ancho={44} alto={22} />
          </span>
        )}
      </div>

      {!cargando && (comparacion || nota) && (
        <div className="flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-1">
          {comparacion && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorComparacion}`}>
              <FlechaComparacion size={13} aria-hidden="true" />
              <span className="font-mono tabular-nums">{comparacion.texto}</span>
            </span>
          )}
          {comparacion && (
            <span className="text-xs text-content-secondary">{comparacion.contra}</span>
          )}
          {/* La nota explica QUÉ mide la curva, o por qué esta métrica no
              tiene una. Se enseña con o sin comparación: una cifra sin flecha
              debe decir por qué no la tiene, o parece que falta. */}
          {nota && <span className="text-xs text-content-secondary">{nota}</span>}
        </div>
      )}
    </Link>
  );
}

/** Sin cambio no hay ni mejora ni empeora: el color se queda neutro. */
function esFarolNeutro(c?: ComparacionMetrica): boolean {
  return !c || c.direccion === 'igual';
}
