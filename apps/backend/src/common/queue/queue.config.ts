// Configuración de la cola durable (BullMQ sobre Redis).
//
// Redis NO es fuente de verdad: el estado durable vive en PostgreSQL. Redis
// solo transporta trabajos. Perderlo degrada el procesamiento asíncrono
// —esperas, reintentos, automatizaciones diferidas— pero nunca los datos
// comerciales. Esa separación es deliberada y condiciona todo lo demás:
// ningún job puede ser la única copia de un hecho de negocio.

export const QUEUE_NAMES = {
  /** Efectos de un mensaje entrante: asignación, automatizaciones, avisos. */
  INBOUND: 'takto.inbound',
  /** Ejecuciones de automatización, incluidas las esperas diferidas. */
  AUTOMATION: 'takto.automation',
  /** Descarga de medios de WhatsApp, fuera del webhook. */
  MEDIA: 'takto.media',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Conexión a Redis. Sin contraseña por defecto a propósito: en staging Redis
 * vive solo en la red `internal` de Docker, sin puertos publicados, igual que
 * PostgreSQL. Si algún día se expone, `REDIS_PASSWORD` pasa a ser obligatoria
 * y esta función la exige.
 */
export function buildRedisConnection(env: NodeJS.ProcessEnv = process.env) {
  const host = env.REDIS_HOST?.trim() || 'redis';
  const port = Number(env.REDIS_PORT ?? 6379);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT debe ser un puerto válido');
  }

  return {
    host,
    port,
    ...(env.REDIS_PASSWORD?.trim()
      ? { password: env.REDIS_PASSWORD.trim() }
      : {}),
    // BullMQ lo exige: sin esto, un comando bloqueante reintenta para siempre
    // y el worker se queda colgado en silencio en vez de fallar visible.
    maxRetriesPerRequest: null,
  };
}

/**
 * Política de reintentos por defecto.
 *
 * Backoff exponencial desde 5 s: 5 s, 10 s, 20 s, 40 s, 80 s. Cinco intentos
 * cubren un corte breve de Meta o de la base sin convertir un fallo
 * permanente en un bucle infinito.
 *
 * `removeOnFail: false` es deliberado: un job fallido debe QUEDARSE en la
 * cola para poder inspeccionarlo y reejecutarlo. Es el equivalente a una
 * dead-letter queue, y sin él los fallos desaparecerían igual que hoy se
 * tragan en el motor de automatizaciones actual.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  // Los completados se limpian para que Redis no crezca sin límite; se
  // conservan los últimos por si hace falta diagnosticar.
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
} as const;
