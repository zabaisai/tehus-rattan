import { TaskPriority, TaskStatus } from '@/types';

/**
 * Cómo se nombra y se colorea una tarea, en un solo sitio.
 *
 * Estas tablas vivían dentro de `app/dashboard/tasks/page.tsx`. Al enseñar la
 * agenda también en el Inicio harían falta dos copias, y dos copias de una
 * traducción son dos sitios donde la misma tarea puede salir como «Alta» en
 * una pantalla y «HIGH» en la otra. Es la misma razón por la que `timeAgo`
 * salió de `ConversationList` a `lib/tiempo`.
 *
 * El orden importa: `URGENT` primero, porque es el criterio con el que se
 * ordena la agenda cuando dos tareas vencen a la misma hora.
 */
export const ETIQUETA_PRIORIDAD: Record<TaskPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

/**
 * Clases de la insignia de prioridad.
 *
 * `HIGH` y `URGENT` usan los tonos `*-strong`: a 11 px el tono oficial se
 * queda en 3,9:1 sobre su propia superficie, por debajo del mínimo para
 * texto. Es la regla ya documentada en `DESIGN-SYSTEM.md`.
 */
export const CLASES_PRIORIDAD: Record<TaskPriority, string> = {
  LOW: 'bg-neutral-100 text-neutral-600',
  MEDIUM: 'bg-status-info-surface text-status-info',
  HIGH: 'bg-status-warning-surface text-status-warning-strong',
  URGENT: 'bg-status-error-surface text-status-error',
};

/** Cuánto pesa cada prioridad al ordenar. Mayor = antes. */
export const PESO_PRIORIDAD: Record<TaskPriority, number> = {
  URGENT: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
};

export const ETIQUETA_ESTADO_TAREA: Partial<Record<TaskStatus, string>> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En progreso',
};

/** `true` si la tarea sigue viva: ni completada ni cancelada. */
export function estaPendiente(status: TaskStatus): boolean {
  return status !== 'COMPLETED' && status !== 'CANCELLED';
}
