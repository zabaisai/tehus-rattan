import { isQueueWorker } from '../queue/queue.role';

/**
 * ¿Debe este proceso ejecutar los trabajos programados (`@Cron`, `@Interval`)?
 *
 * EL PROBLEMA QUE RESUELVE: backend y worker comparten imagen y `AppModule`,
 * así que ambos registran los mismos `@Cron`. Todo lo programado corre por
 * duplicado —limpiezas, avisos, barridos de SLA—. Hoy no se ve porque las
 * notificaciones se deduplican por clave y los borrados son idempotentes,
 * pero es una coincidencia afortunada, no un diseño: el primer trabajo
 * programado que tenga efectos acumulativos (crear una tarea, cobrar, enviar
 * un mensaje) se ejecutaría dos veces.
 *
 * LA REGLA: los trabajos programados corren en el WORKER, que es el proceso
 * dedicado a trabajo de fondo. Si no hay worker —desarrollo, pruebas, un
 * despliegue sin Redis— corre el proceso único que haya, porque el CRM debe
 * seguir haciendo sus limpiezas y avisos aunque no exista worker.
 */
export function shouldRunScheduledJobs(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isQueueWorker(env)) return true;
  // Sin cola no hay worker: este es el único proceso que existe.
  return env.QUEUE_ENABLED?.trim() === 'false';
}
