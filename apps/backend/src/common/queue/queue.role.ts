/**
 * Rol del proceso dentro del sistema de colas.
 *
 * REGLA CRÍTICA: solo el WORKER registra procesadores; el backend solo
 * produce. Si ambos procesaran, cada job correría dos veces y los efectos se
 * duplicarían — dos automatizaciones, dos notificaciones, dos mensajes
 * salientes al cliente. Es el error más fácil de cometer al compartir imagen
 * y AppModule entre los dos procesos, y el más difícil de diagnosticar,
 * porque en desarrollo (donde solo corre uno) nunca se manifiesta.
 *
 * El worker se identifica por `WORKER_ROLE=queue`, que `docker-compose`
 * inyecta solo en ese servicio.
 */
export function isQueueWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKER_ROLE?.trim() === 'queue';
}

/**
 * ¿Debe este proceso registrar procesadores de cola?
 *
 * Solo si es el worker Y la cola está habilitada. Con `QUEUE_ENABLED=false`
 * nadie procesa: es el modo de tests y de desarrollo sin Docker, donde los
 * efectos se ejecutan en línea como hasta ahora.
 */
export function shouldConsumeQueue(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isQueueWorker(env) && env.QUEUE_ENABLED?.trim() !== 'false';
}

/**
 * ¿Debe este proceso ENCOLAR en vez de ejecutar en línea?
 *
 * Solo cuando la cola está habilitada. Si no lo está, el productor ejecuta
 * los efectos directamente, de modo que el CRM sigue funcionando entero sin
 * Redis — degradado en latencia, nunca en funcionalidad. Esa marcha atrás
 * automática es lo que permite desplegar la cola sin convertirla en un punto
 * único de fallo desde el primer día.
 */
export function shouldEnqueue(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QUEUE_ENABLED?.trim() !== 'false';
}
