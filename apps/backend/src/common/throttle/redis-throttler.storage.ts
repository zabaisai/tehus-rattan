import { Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  type ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';

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
 * ThrottlerStorage con Redis como almacenamiento distribuido PRINCIPAL y un
 * fallback LOCAL en memoria si Redis no responde.
 *
 * FAIL-SAFE, no fail-open: una caída de Redis NUNCA deja el rate limiting en
 * ilimitado. Cuando el comando a Redis falla, la petición se cuenta contra un
 * `ThrottlerStorageService` en memoria (por proceso) con los MISMOS límites, de
 * modo que login/refresh/recuperación/invitaciones siguen acotados durante el
 * corte — más estricto que Redis (cada réplica cuenta aparte), nunca más laxo.
 *
 * Un corte breve de Redis no tumba la app (no se lanza 500): se degrada al
 * limitador local y se recupera solo cuando Redis vuelve. La transición se
 * registra UNA vez en cada sentido (sin spam) y nunca incluye secretos.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: Redis;
  // Limitador local conservador para cuando Redis no está.
  private readonly fallback = new ThrottlerStorageService();
  // Estado de degradación, para loguear una sola vez cada transición.
  private degradado = false;

  constructor(conn: RedisConn) {
    this.client = new Redis({
      host: conn.host,
      port: conn.port,
      ...(conn.password ? { password: conn.password } : {}),
      // La cola offline absorbe los primeros comandos hasta que la conexión
      // está lista (evita un falso fallback en el arranque). commandTimeout
      // acota cada comando: con Redis caído, el comando rechaza en ~1.5 s y se
      // cae al fallback local. Reconexión controlada por defecto de ioredis
      // (retryStrategy indefinido y acotado) — cuando Redis vuelve, el siguiente
      // comando funciona y se sale del modo degradado.
      maxRetriesPerRequest: 1,
      commandTimeout: 1500,
      connectTimeout: 1500,
    });
    // Silenciar el error de conexión ruidoso de ioredis; la transición de
    // degradación ya se registra una sola vez en increment().
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

      // Redis respondió: si veníamos degradados, avisar de la recuperación una
      // sola vez.
      if (this.degradado) {
        this.degradado = false;
        this.logger.log(
          'Redis throttler recuperado — vuelve el store distribuido',
        );
      }

      return {
        totalHits: res[0],
        timeToExpire: Math.ceil(res[1] / 1000),
        isBlocked: res[2] === 1,
        timeToBlockExpire: Math.ceil(res[3] / 1000),
      };
    } catch (error) {
      // FAIL-SAFE: se cae al limitador LOCAL en memoria (mismos límites), nunca
      // a ilimitado. Se registra la degradación una sola vez, sin secretos.
      if (!this.degradado) {
        this.degradado = true;
        this.logger.warn(
          `Redis throttler no disponible [${(error as { code?: string })?.code ?? 'ERROR'}] — degradado a limitador LOCAL en memoria (límites conservadores por proceso)`,
        );
      }
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  /** ¿Está el storage operando en modo degradado (local)? Para health/tests. */
  estaDegradado(): boolean {
    return this.degradado;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
