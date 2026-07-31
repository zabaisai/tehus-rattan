/**
 * Marca TAKTO.
 *
 * Va como SVG inline y no como `<img>` a propósito: el wordmark es texto vivo
 * en Archivo ExtraBold, y en un `<img>` el navegador no tiene acceso a la
 * fuente autoalojada del documento, así que caería a Arial y el logotipo se
 * vería distinto según la máquina.
 *
 * REGLAS DE MARCA QUE ESTE COMPONENTE FIJA
 *   · División cromática obligatoria del wordmark: **TAK** navy, **TO**
 *     naranja. No es decorativa, es la marca.
 *   · El isotipo es un par rotacional a 180°; su canal central NO se abre ni
 *     se reescala por separado — por eso la geometría vive aquí y no se
 *     recompone en cada uso.
 *   · Sobre fondo oscuro, TAK pasa a blanco y TO conserva el naranja.
 */

const NAVY = '#131C4A';
const NARANJA = '#FF6A00';

export function TaktoLogo({
  variant = 'lockup',
  tone = 'primary',
  className,
  height = 30,
}: {
  /** `lockup`: isotipo + wordmark. `wordmark`: solo texto. `isotype`: solo símbolo. */
  variant?: 'lockup' | 'wordmark' | 'isotype';
  /** `negative` para fondos oscuros. */
  tone?: 'primary' | 'negative';
  className?: string;
  height?: number;
}) {
  const tak = tone === 'negative' ? '#FFFFFF' : NAVY;
  // El naranja NO cambia en negativo: es lo que mantiene reconocible la marca
  // sobre cualquier fondo.
  const to = NARANJA;
  const isotipoA = tone === 'negative' ? '#FFFFFF' : NAVY;

  const viewBox =
    variant === 'lockup' ? '0 0 132 30' : variant === 'wordmark' ? '0 0 90 30' : '0 0 24 24';
  const ancho =
    variant === 'lockup' ? (height * 132) / 30 : variant === 'wordmark' ? (height * 90) / 30 : height;

  return (
    <svg
      viewBox={viewBox}
      height={height}
      width={ancho}
      role="img"
      aria-label="TAKTO"
      className={className}
    >
      {variant !== 'wordmark' && (
        <g transform={variant === 'lockup' ? 'translate(3 3)' : undefined}>
          <path d="M0 0H13V9H8V24H0Z" fill={isotipoA} />
          <path d="M24 24H11V15H16V0H24Z" fill={to} />
        </g>
      )}
      {variant !== 'isotype' && (
        <text
          x={variant === 'lockup' ? 42 : 0}
          y="22.4"
          fontFamily="var(--font-archivo), Archivo, Helvetica, Arial, sans-serif"
          fontWeight="800"
          fontSize="21.6"
          letterSpacing="-0.6"
        >
          <tspan fill={tak}>TAK</tspan>
          <tspan fill={to}>TO</tspan>
        </text>
      )}
    </svg>
  );
}
