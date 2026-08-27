import type { ThrottlerStorage } from '@nestjs/throttler';
import { buildRedisConnection } from '../queue/queue.config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * ¿Se usa el store de rate limiting compartido en Redis?
 *
 * Solo fuera de pruebas (para que la suite sea determinista y no dependa de
 * Redis) y cuando la cola está habilitada (`QUEUE_ENABLED !== 'false'`), que es
 * la misma señal que ya gobierna Redis en el resto de la app. En pruebas y con
 * la cola apagada se usa el store en memoria por defecto de @nestjs/throttler.
 */
export function usaRedisThrottler(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV?.trim() === 'test') return false;
  return env.QUEUE_ENABLED?.trim() !== 'false';
}

/** Construye el storage Redis, o `undefined` para caer al store por defecto. */
export function buildThrottlerStorage(
  env: NodeJS.ProcessEnv = process.env,
): ThrottlerStorage | undefined {
  if (!usaRedisThrottler(env)) return undefined;
  const { host, port, password } = buildRedisConnection(env) as {
    host: string;
    port: number;
    password?: string;
  };
  return new RedisThrottlerStorage({ host, port, password });
}
