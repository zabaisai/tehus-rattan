import { Lock } from 'lucide-react';

/**
 * «Esto existe, pero tu rol no lo ve.»
 *
 * EXISTE PORQUE UN 403 NO ES UN ERROR. El estado de error dice «algo falló» e
 * invita a reintentar; con un permiso denegado, reintentar no arregla nada y
 * deja al usuario pensando que el producto está roto. Aquí se dice qué falta y
 * a quién pedírselo.
 *
 * No revela el dato ni su tamaño: solo que la sección requiere otro rol.
 */
export function ForbiddenState({
  titulo = 'No tienes permiso para ver esto',
  detalle,
  className = '',
}: {
  titulo?: string;
  /** Qué rol lo ve, para que el usuario sepa a quién pedirlo. */
  detalle?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-subtle px-4 py-8 text-center ${className}`}
    >
      <Lock size={20} aria-hidden="true" className="text-content-disabled" />
      <p className="text-sm font-medium text-content-primary">{titulo}</p>
      {detalle && (
        <p className="max-w-xs text-xs text-content-secondary">{detalle}</p>
      )}
    </div>
  );
}
