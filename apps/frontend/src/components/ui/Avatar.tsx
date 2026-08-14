/**
 * Persona representada por sus INICIALES, nunca por una fotografía.
 *
 * Es una regla del plan maestro, no una preferencia estética: el producto no
 * usa fotos de perfil ni rostros. Los mockups las dibujan, pero una foto de
 * cliente es un dato personal más que almacenar, servir y filtrar sin ninguna
 * necesidad funcional.
 *
 * El color sale del propio nombre, así que la misma persona se ve igual en
 * todas las pantallas sin guardar nada. Los tonos son de la escala de marca:
 * un avatar no es un semáforo y no debe competir con los colores de estado.
 */
const TONOS = [
  'bg-primary-100 text-primary-800',
  'bg-primary-200 text-primary-900',
  'bg-neutral-200 text-neutral-800',
  'bg-secondary-100 text-secondary-900',
] as const;

const TAMANOS = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  // Cabecera del perfil 360: ahí el avatar es el ancla visual de la ficha,
  // no un adorno de fila.
  lg: 'h-14 w-14 text-lg',
} as const;

export function iniciales(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim();
  if (!limpio) return '?';
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function tonoDe(nombre: string): string {
  let suma = 0;
  for (let i = 0; i < nombre.length; i++) suma += nombre.charCodeAt(i);
  return TONOS[suma % TONOS.length];
}

export function Avatar({
  nombre,
  size = 'md',
  className = '',
}: {
  nombre: string | null | undefined;
  size?: keyof typeof TAMANOS;
  className?: string;
}) {
  const texto = nombre?.trim() || '';
  return (
    <span
      // Decorativo: el nombre ya está escrito al lado. Leerlo dos veces —una
      // como iniciales sueltas— solo alarga la escucha.
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${TAMANOS[size]} ${tonoDe(texto)} ${className}`}
    >
      {iniciales(texto)}
    </span>
  );
}
