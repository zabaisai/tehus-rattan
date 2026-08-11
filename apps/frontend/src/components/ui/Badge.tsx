export type TonoBadge =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'accent';

/**
 * Etiqueta de estado.
 *
 * Los tonos salen de los colores SEMÁNTICOS de la marca, no de una paleta
 * suelta: así el mismo significado se ve igual en la bandeja, en el tablero y
 * en un PDF. Cuando cada pantalla elige su verde, "resuelto" acaba teniendo
 * tres verdes distintos y el usuario deja de leerlos como una señal.
 *
 * El tono `accent` usa naranja de FONDO con texto navy —nunca naranja como
 * texto fino sobre claro, que es lo que prohíbe el manual por contraste—.
 */
const TONOS: Record<TonoBadge, string> = {
  neutral: 'bg-neutral-100 text-neutral-600',
  // Éxito y aviso usan el tono `*-strong`, no el oficial. Con el oficial este
  // texto daba 3,87:1 y 3,89:1 sobre su propia superficie, por debajo del
  // mínimo, y encima a 10px. Error e información sí cumplen con el oficial
  // (4,85:1 y 4,91:1), así que se quedan como estaban.
  success: 'bg-status-success-surface text-status-success-strong',
  warning: 'bg-status-warning-surface text-status-warning-strong',
  error: 'bg-status-error-surface text-status-error',
  info: 'bg-status-info-surface text-status-info',
  accent: 'bg-brand-secondary text-brand-primary',
};

export function Badge({
  tone = 'neutral',
  className = '',
  children,
  ...resto
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: TonoBadge }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${TONOS[tone]} ${className}`}
      {...resto}
    >
      {children}
    </span>
  );
}

/**
 * Tono de cada estado de conversación.
 *
 * Vive aquí y no en cada pantalla por el mismo motivo que los tonos: es la
 * traducción de un significado a un color, y debe ser una sola.
 */
export function tonoDeEstadoConversacion(estado: string): TonoBadge {
  switch (estado) {
    case 'OPEN':
      return 'info';
    case 'PENDING':
      return 'warning';
    case 'RESOLVED':
      return 'success';
    case 'CLOSED':
    case 'ARCHIVED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Tono de cada estado de oportunidad. */
export function tonoDeEstadoLead(estado: string): TonoBadge {
  switch (estado) {
    case 'WON':
      return 'success';
    case 'LOST':
      return 'error';
    default:
      return 'info';
  }
}
