import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/common/throttle/redis-throttler.storage';

/**
 * Store de rate limiting compartido en Redis, contra un Redis REAL.
 *
 * Lo que importa aquí no lo demuestra un doble: que el incremento + el TTL de
 * la ventana + el bloqueo ocurren de forma atómica en Redis, y que un fallo de
 * Redis es fail-open (permite) en vez de tumbar el endpoint. En CI hay un
 * servicio Redis; en local, el docker-compose de dev lo levanta.
 */
const HOST = process.env.REDIS_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.REDIS_PORT ?? 6379);

describe('RedisThrottlerStorage (Redis real)', () => {
  let storage: RedisThrottlerStorage;
  let redis: Redis;

  beforeAll(() => {
    storage = new RedisThrottlerStorage({ host: HOST, port: PORT });
    redis = new Redis({ host: HOST, port: PORT, maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    await (
      storage as unknown as { onModuleDestroy: () => Promise<void> }
    ).onModuleDestroy();
    await redis.quit();
  });

  const clave = () => `e2e-thr-${Date.now()}-${Math.random()}`;

  it('cuenta los hits dentro de la ventana y fija el TTL', async () => {
    const key = clave();
    const r1 = await storage.increment(key, 60_000, 5, 60_000, 'default');
    expect(r1.totalHits).toBe(1);
    expect(r1.isBlocked).toBe(false);
    expect(r1.timeToExpire).toBeGreaterThan(0);
    expect(r1.timeToExpire).toBeLessThanOrEqual(60);

    const r2 = await storage.increment(key, 60_000, 5, 60_000, 'default');
    expect(r2.totalHits).toBe(2);
  });

  it('bloquea al superar el límite y sigue bloqueado después', async () => {
    const key = clave();
    let last;
    for (let i = 0; i < 3; i++) {
      last = await storage.increment(key, 60_000, 2, 60_000, 'default');
    }
    // 3 hits con límite 2 → bloqueado.
    expect(last!.isBlocked).toBe(true);
    expect(last!.timeToBlockExpire).toBeGreaterThan(0);

    // Un hit más sigue bloqueado sin volver a contar la ventana.
    const extra = await storage.increment(key, 60_000, 2, 60_000, 'default');
    expect(extra.isBlocked).toBe(true);
  });

  it('claves de distinto throttlerName no se pisan', async () => {
    const key = clave();
    const a = await storage.increment(key, 60_000, 5, 60_000, 'auth');
    const b = await storage.increment(key, 60_000, 5, 60_000, 'default');
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(1);
  });

  it('fail-open: con Redis inalcanzable devuelve permitido, no lanza', async () => {
    // Puerto cerrado a propósito.
    const caido = new RedisThrottlerStorage({ host: '127.0.0.1', port: 1 });
    const r = await caido.increment('x', 60_000, 5, 60_000, 'default');
    expect(r.isBlocked).toBe(false);
    expect(r.totalHits).toBe(0);
    await (
      caido as unknown as { onModuleDestroy: () => Promise<void> }
    ).onModuleDestroy();
  });
});
