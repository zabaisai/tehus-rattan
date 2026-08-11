/**
 * Superficie elevada del sistema TAKTO.
 *
 * El producto repite `rounded-lg border border-neutral-200 bg-white shadow-sm`
 * en decenas de pantallas, y cada copia se desvía un poco: unas quedan en
 * `rounded-xl`, otras pierden la sombra, otras traen el borde de otro gris.
 * Reunidas aquí, el radio y la sombra salen de los tokens de marca y cambiarlos
 * es un cambio, no una campaña.
 *
 * `padding` es opcional porque hay tarjetas que no lo quieren: las que llevan
 * una tabla o una cabecera a sangre necesitan controlar su propio espaciado.
 */
export type PaddingCard = 'none' | 'sm' | 'md' | 'lg';

const PADDINGS: Record<PaddingCard, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-6 sm:p-8',
};

export interface PropsCard extends React.HTMLAttributes<HTMLDivElement> {
  padding?: PaddingCard;
  /** Sin sombra, solo borde: para tarjetas anidadas dentro de otra superficie. */
  flat?: boolean;
}

export function Card({
  padding = 'md',
  flat = false,
  className = '',
  children,
  ...resto
}: PropsCard) {
  return (
    <div
      className={`rounded-lg border border-line-default bg-surface-default ${
        flat ? '' : 'shadow-sm'
      } ${PADDINGS[padding]} ${className}`}
      {...resto}
    >
      {children}
    </div>
  );
}
