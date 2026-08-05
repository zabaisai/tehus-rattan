import 'reflect-metadata';
import { EventEmitter } from 'events';
import type { Redis } from 'ioredis';
import { pingCuandoListo } from '../redis/redis-ready';

/**
 * La carrera del sondeo de la cola.
 *
 * `QueuePingService` crea su cliente con `lazyConnect: true`. El estado
 * inicial de ioredis entonces es `'wait'`, y el código anterior solo llamaba a
 * `connect()` para `'end'` y `'close'`. Resultado: el primer sondeo tras cada
 * arranque pingueaba un socket sin abrir, `enableOfflineQueue: false` lo
 * rechazaba en el acto, y el health publicaba «cola caída» contra una Redis
 * perfectamente disponible.
 *
 * Se veía como un `degraded` fugaz en cada despliegue. Por desaparecer solo,
 * nadie lo investigaba.
 */
class ClientePerezoso extends EventEmitter {
  status = 'wait';
  conexiones = 0;
  pings = 0;

  /** Como ioredis: nada se conecta hasta que alguien lo pide. */
  connect(): Promise<void> {
    this.conexiones++;
    if (this.status === 'ready') {
      return Promise.reject(new Error('Redis is already connecting/connected'));
    }
    this.status = 'connecting';
    setTimeout(() => {
      this.status = 'ready';
      this.emit('ready');
    }, 5);
    return Promise.resolve();
  }

  ping(): Promise<string> {
    this.pings++;
    if (this.status !== 'ready') {
      return Promise.reject(
        new Error(
          "Stream isn't writeable and enableOfflineQueue options is false",
        ),
      );
    }
    return Promise.resolve('PONG');
  }

  comoRedis(): Redis {
    return this as unknown as Redis;
  }
}

describe('sondeo de la cola contra un cliente perezoso', () => {
  it('REPRODUCE EL FALLO: con estado "wait" pide la conexión y espera', async () => {
    const c = new ClientePerezoso();
    expect(c.status).toBe('wait');

    await expect(pingCuandoListo(c.comoRedis(), 500)).resolves.toBe('PONG');

    // Pidió la conexión —lo que el código anterior no hacía para 'wait'— y
    // no malgastó ningún PING contra un socket cerrado.
    expect(c.conexiones).toBe(1);
    expect(c.pings).toBe(1);
  });

  it('con el cliente ya listo no vuelve a conectar', async () => {
    const c = new ClientePerezoso();
    c.status = 'ready';

    await expect(pingCuandoListo(c.comoRedis(), 500)).resolves.toBe('PONG');

    expect(c.conexiones).toBe(0);
  });

  it('reabre una conexión cerrada', async () => {
    const c = new ClientePerezoso();
    c.status = 'close';

    await expect(pingCuandoListo(c.comoRedis(), 500)).resolves.toBe('PONG');
    expect(c.conexiones).toBe(1);
  });

  it('si Redis NO está, se rinde a tiempo en vez de colgarse', async () => {
    const c = new ClientePerezoso();
    // Nunca llega a estar lista: ni 'ready' ni 'end'.
    c.connect = () => {
      c.conexiones++;
      c.status = 'connecting';
      return Promise.resolve();
    };

    const inicio = Date.now();
    await expect(pingCuandoListo(c.comoRedis(), 60)).rejects.toThrow(
      /RedisNoDisponible/,
    );
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it('una conexión que muere no espera al límite completo', async () => {
    const c = new ClientePerezoso();
    c.connect = () => {
      c.conexiones++;
      c.status = 'connecting';
      setTimeout(() => {
        c.status = 'end';
        c.emit('end');
      }, 5);
      return Promise.resolve();
    };

    await expect(pingCuandoListo(c.comoRedis(), 3_000)).rejects.toThrow();
  });

  it('no deja escuchadores acumulados tras varios sondeos', async () => {
    const c = new ClientePerezoso();
    await pingCuandoListo(c.comoRedis(), 500);
    await pingCuandoListo(c.comoRedis(), 500);
    await pingCuandoListo(c.comoRedis(), 500);

    expect(c.listenerCount('ready')).toBe(0);
    expect(c.listenerCount('end')).toBe(0);
  });
});
