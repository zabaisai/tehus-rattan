'use client';

import { useEffect, useState } from 'react';
import { TaktoLogo } from '@/components/ui/TaktoLogo';

/**
 * Panel ilustrativo del login.
 *
 * TODO LO QUE SE VE AQUÍ ES INVENTADO Y GENÉRICO. No hay ni una petición al
 * servidor, ni un nombre de empresa, ni un nombre de persona, ni un importe:
 * antes de iniciar sesión no existe una empresa a la que atribuir un dato, y
 * pintar cifras con aire de reales en la puerta del producto es enseñar datos
 * de nadie como si fueran de alguien. Por eso la leyenda «Vista ilustrativa»
 * es parte del panel, no una nota al pie opcional.
 *
 * Es además `aria-hidden` completo y sin un solo elemento enfocable: para
 * quien navega con teclado o lector de pantalla esto es ruido decorativo, y lo
 * único que le importa —la leyenda— se le entrega aparte, en un `sr-only` que
 * vive FUERA de este subárbol (lo pone la página).
 */

/** Cifras sintéticas fijas. No salen de ninguna consulta. */
const METRICAS = [
  { etiqueta: 'Conversaciones', valor: 128 },
  { etiqueta: 'Sin responder', valor: 12 },
  { etiqueta: 'Pipeline abierto', valor: 34 },
  { etiqueta: 'Asesores en línea', valor: 6 },
] as const;

/** Alturas relativas de las barras, en porcentaje. Sintéticas. */
const BARRAS = [38, 62, 45, 80, 56] as const;

const ETAPAS = ['Nuevo', 'Contactado', 'Cotizado', 'Negociación', 'Ganado'] as const;

/** Líneas de actividad genéricas: sin nombres, sin empresas, sin importes. */
const ACTIVIDAD = [
  'Nueva oportunidad en Contactado',
  'Cotización enviada',
  'Conversación asignada a un asesor',
] as const;

export const LEYENDA_ILUSTRATIVA =
  'Vista ilustrativa. La información de tu empresa aparece después de iniciar sesión.';

const DURACION_CONTEO_MS = 900;
const PASOS_CONTEO = 18;

/** `true` si el sistema pide menos movimiento. Defensivo: puede no haber matchMedia. */
export function prefiereMenosMovimiento(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Cuenta de 0 al valor final en ~900 ms con un intervalo que SE PARA solo.
 *
 * No hay `requestAnimationFrame` en bucle: son 18 ticks y se acabó. Un login
 * abierto en segundo plano no debe seguir animando nada.
 */
function useConteo(valores: readonly number[]): number[] {
  const [progreso, setProgreso] = useState(() => (prefiereMenosMovimiento() ? 1 : 0));

  useEffect(() => {
    if (prefiereMenosMovimiento()) return;

    let paso = 0;
    const intervalo = setInterval(() => {
      paso += 1;
      setProgreso(paso / PASOS_CONTEO);
      if (paso >= PASOS_CONTEO) clearInterval(intervalo);
    }, DURACION_CONTEO_MS / PASOS_CONTEO);

    return () => clearInterval(intervalo);
  }, []);

  return valores.map((valor) => Math.round(valor * progreso));
}

export function LoginShowcase() {
  const conteos = useConteo(METRICAS.map((m) => m.valor));
  const [crecido, setCrecido] = useState(() => prefiereMenosMovimiento());
  const [destacada, setDestacada] = useState(0);

  // Las barras crecen una sola vez, en el primer pintado.
  useEffect(() => {
    if (prefiereMenosMovimiento()) return;
    const temporizador = setTimeout(() => setCrecido(true), 30);
    return () => clearTimeout(temporizador);
  }, []);

  // Rotación de la línea destacada. Un único intervalo, limpiado al desmontar.
  useEffect(() => {
    if (prefiereMenosMovimiento()) return;
    const intervalo = setInterval(
      () => setDestacada((actual) => (actual + 1) % ACTIVIDAD.length),
      3200,
    );
    return () => clearInterval(intervalo);
  }, []);

  return (
    <div
      // Decorativo de principio a fin: nada de lo que hay aquí es información
      // real, así que se oculta al árbol accesible en bloque.
      aria-hidden="true"
      data-testid="login-showcase"
      // Solo se monta a partir de 1024 px (lo decide la página), así que el
      // ancho del 56 % y el `flex` van sin condicionar.
      className="relative flex w-[56%] min-w-0 flex-col justify-between overflow-hidden bg-brand-primary p-10 xl:p-14"
    >
      {/* Rejilla geométrica: dos degradados, cero imágenes y cero peticiones. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FF6A00 0%, transparent 70%)' }}
      />

      <div className="relative min-w-0">
        <TaktoLogo variant="lockup" tone="negative" height={30} />

        <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.22em] text-secondary-400">
          Centro de control comercial
        </p>
        <h2 className="mt-3 max-w-md font-brand text-3xl leading-tight font-extrabold text-white xl:text-4xl">
          Toma el mando de cada jugada.
        </h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-primary-100">
          Conversaciones, oportunidades y asesores en un solo tablero. Entra y
          continúa exactamente donde lo dejó tu equipo.
        </p>
      </div>

      <div className="relative mt-10 min-w-0">
        <div className="grid grid-cols-2 gap-3">
          {METRICAS.map((metrica, indice) => (
            <div
              key={metrica.etiqueta}
              className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-4"
            >
              <p className="truncate text-[11px] uppercase tracking-wider text-primary-200">
                {metrica.etiqueta}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
                {conteos[indice]}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] uppercase tracking-wider text-primary-200">
            Pipeline por etapa
          </p>
          <div className="mt-3 flex h-24 items-end gap-2">
            {BARRAS.map((altura, indice) => (
              <div key={ETAPAS[indice]} className="flex min-w-0 flex-1 flex-col items-center">
                <div className="flex h-20 w-full items-end">
                  <div
                    className="w-full rounded-t bg-brand-secondary/80 transition-[height] duration-700 ease-out motion-reduce:transition-none"
                    style={{ height: crecido ? `${altura}%` : '0%' }}
                  />
                </div>
                <span className="mt-1 w-full truncate text-center text-[9px] text-primary-200">
                  {ETAPAS[indice]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {ACTIVIDAD.map((linea, indice) => (
            <li
              key={linea}
              className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors duration-500 motion-reduce:transition-none ${
                indice === destacada
                  ? 'bg-white/10 text-white'
                  : 'bg-white/[0.03] text-primary-200'
              }`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-secondary" />
              <span className="truncate">{linea}</span>
            </li>
          ))}
        </ul>

        {/* Visible para quien ve la pantalla. Su copia accesible la pone la
            página fuera de este subárbol `aria-hidden`. */}
        <p className="mt-5 text-[11px] leading-relaxed text-primary-200/80">
          {LEYENDA_ILUSTRATIVA}
        </p>
      </div>
    </div>
  );
}
