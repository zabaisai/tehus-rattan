'use client';

import { AlertTriangle, LucideIcon } from 'lucide-react';
import { EmptyState } from './EmptyState';

/**
 * Los tres estados de una lista: cargando, error y vacía.
 *
 * EXISTE PORQUE LAS CINCO PANTALLAS TENÍAN EL MISMO FALLO. Todas hacían
 * `!isLoading && !datos?.length` para decidir si enseñar el estado vacío, y
 * `datos` también es `undefined` cuando la consulta falla. Resultado: un 403
 * o un servidor caído se veían exactamente igual que «todavía no tienes
 * ninguna automatización». Es la peor confusión posible, porque la respuesta
 * correcta a cada caso es opuesta: en uno hay que crear algo, en el otro hay
 * que avisar de que no se está viendo lo que sí existe.
 *
 * Devuelve `null` cuando hay datos, para que la pantalla dibuje su lista.
 */
export function ListState({
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  icon,
  emptyMessage,
  emptyAction,
  loadingMessage = 'Cargando…',
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  error?: unknown;
  onRetry?: () => void;
  icon?: LucideIcon;
  emptyMessage: string;
  emptyAction?: React.ReactNode;
  loadingMessage?: string;
}) {
  if (isLoading) {
    return (
      <p className="py-10 text-center text-sm text-neutral-400">
        {loadingMessage}
      </p>
    );
  }

  if (isError) {
    return (
      // Rojo de ESTADO de la marca, no el `red-*` de Tailwind: es el mismo
      // rojo que usan el badge de error y el botón destructivo, y así "algo
      // falló" se ve igual en toda la aplicación.
      <div
        role="alert"
        className="flex flex-col items-center gap-2 rounded-lg border border-status-error/20 bg-status-error-surface py-10 text-center"
      >
        <AlertTriangle
          size={24}
          aria-hidden="true"
          className="text-status-error"
          strokeWidth={1.5}
        />
        <p className="text-sm font-medium text-status-error">
          {mensajeDeError(error)}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-status-error/30 bg-surface-default px-2.5 py-1.5 text-xs text-status-error outline-none transition-colors hover:bg-status-error-surface focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState icon={icon} message={emptyMessage} action={emptyAction} />
    );
  }

  return null;
}

/**
 * Un 403 no es «se cayó algo»: es «no tienes permiso», y decirlo evita que
 * alguien reintente diez veces o abra una incidencia por un servidor que está
 * perfectamente bien.
 */
export function mensajeDeError(e: unknown): string {
  const respuesta = (
    e as { response?: { status?: number; data?: { message?: unknown } } }
  )?.response;

  if (respuesta?.status === 403) {
    return 'No tienes permiso para ver esto.';
  }
  if (respuesta?.status === 401) {
    return 'Tu sesión caducó. Vuelve a entrar.';
  }

  const detalle = respuesta?.data?.message;
  if (typeof detalle === 'string') return detalle;
  if (Array.isArray(detalle) && typeof detalle[0] === 'string') {
    return detalle[0];
  }

  return 'No se pudo cargar. Comprueba tu conexión y reintenta.';
}
