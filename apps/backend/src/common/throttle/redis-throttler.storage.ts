import { Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';

// La forma que exige el contrato de ThrottlerStorage.increment (no se exporta
// como tipo desde la raíz del paquete, así que se declara aquí).
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Incremento atómico del contador + gestión del bloqueo en UN solo round-trip.
// Devuelve [totalHits, ttlMs, isBlocked(0/1), blockTtlMs].
//
//   KEYS[1] = clave del contador   KEYS[2] = clave de bloqueo
//   ARGV[1] = ttl(ms)  ARGV[2] = limit  ARGV[3] = blockDuration(ms)
//
// Semántica equivalente a la del storage en memoria de @nestjs/throttler:
// - si ya está bloqueado, no cuenta y devuelve el estado de bloqueo;
// - cuenta el hit; si es el primero, fija el TTL de la ventana;
// - si supera el límite, activa el bloqueo por blockDuration.
const LUA_INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local blockPttl = redis.call('PTTL', KEYS[2])
if blockPttl > 0 then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = 0 end
  return {hits, ttl, 1, blockPttl}
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = 0 end
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = 0 end
return {hits, ttl, 0, 0}
`;

interface RedisConn {
  host: string;
  port: number;
  password?: string;
}

/**
 * ThrottlerStorage compartido en Redis: los contadores de rate limiting viven
 * en Redis, así N réplicas del backend comparten el mismo cupo (el store en
 * memoria multiplicaba cada límite por el nº de procesos).
 *
 * FAIL-OPEN: si Redis no responde, se permite la petición en vez de tumbar el
 * endpoint. Perder rate limiting durante un corte de Redis es preferible a
 * devolver 500 a todo el mundo; el corte se ve por el log y por la salud.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: Redis;

  constructor(conn: RedisConn) {
    this.client = new Redis({
      host: conn.host,
      port: conn.port,
      ...(conn.password ? { password: conn.password } : {}),
      // La cola offline absorbe los primeros comandos hasta que la conexión
      // está lista (evita un falso fail-open en el arranque). commandTimeout
      // acota cada comando: con Redis caído, el comando encolado rechaza en
      // ~1.5 s y se cae al fail-open, en vez de colgarse. (Este storage solo se
      // construye fuera de pruebas.)
      maxRetriesPerRequest: 1,
      commandTimeout: 1500,
      connectTimeout: 1500,
    });
    // Silenciar el error de conexión ruidoso; el fail-open ya lo cubre.
    this.client.on('error', () => undefined);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle-block:${throttlerName}:${key}`;
    try {
      const res = (await this.client.eval(
        LUA_INCREMENT,
        2,
        counterKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as [number, number, number, number];

      return {
        totalHits: res[0],
        timeToExpire: Math.ceil(res[1] / 1000),
        isBlocked: res[2] === 1,
        timeToBlockExpire: Math.ceil(res[3] / 1000),
      };
    } catch (error) {
      // Fail-open: nunca bloquea por un fallo de infraestructura.
      this.logger.warn(
        `Redis throttler no disponible [${(error as { code?: string })?.code ?? 'ERROR'}] — fail-open`,
      );
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
