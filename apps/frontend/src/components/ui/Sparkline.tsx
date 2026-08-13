/**
 * Curva diminuta de una serie real.
 *
 * DECORATIVA PARA EL LECTOR DE PANTALLA, y por eso va `aria-hidden`: la cifra
 * y la comparación ya están escritas al lado en texto. Una curva leída punto a
 * punto no aporta nada y alarga la escucha.
 *
 * NO SE DIBUJA SI NO HAY DATO. `puntos` con menos de dos valores devuelve
 * `null`: una línea recta inventada sobre un solo día sugiere una estabilidad
 * que nadie ha medido. Es la misma regla por la que las métricas no tenían
 * tendencia hasta que existió la serie.
 *
 * Sin ejes ni escala: es un indicador de forma, no un gráfico. El gráfico con
 * ejes es el panel «Tendencia de ventas».
 */
export function Sparkline({
  puntos,
  className = '',
  ancho = 72,
  alto = 26,
}: {
  puntos: number[];
  className?: string;
  ancho?: number;
  alto?: number;
}) {
  if (puntos.length < 2) return null;

  const max = Math.max(...puntos);
  const min = Math.min(...puntos);
  const rango = max - min;

  // Una serie plana (todo ceros, por ejemplo) se dibuja como una línea en el
  // centro, no dividiendo por cero ni pegada al borde inferior.
  const y = (v: number) =>
    rango === 0 ? alto / 2 : alto - 2 - ((v - min) / rango) * (alto - 4);
  const x = (i: number) => (i / (puntos.length - 1)) * ancho;

  const d = puntos.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${ancho},${alto} L0,${alto} Z`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
      className={`overflow-visible ${className}`}
    >
      <path d={area} fill="currentColor" className="opacity-10" />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
