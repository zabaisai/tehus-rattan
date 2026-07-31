import { EventEmitter } from 'events';

/**
 * El camino REAL del backend y del worker, con `ioredis` simulado.
 *
 * La prueba de `realtime.redis.spec.ts` cubre la comprobación en aislamiento;
 * esta cubre lo que de verdad se rompió: el adaptador construye sus propios
 * clientes por dentro, y el fallo estaba justo en el hueco entre construirlos
 * y usarlos. Con la comprobación pasada por parámetro nunca se habría visto.
 */

/** Clientes creados durante la prueba, para inspeccionarlos después. */
const creados: ClienteFalso[] = [];

class ClienteFalso extends EventEmitter {
  status = 'connecting';
  pings = 0;
  desconectado = false;
  /** Milisegundos hasta estar listo. `null` = no llega nunca. */
  static demoraListo: number | null = 0;

  constructor() {
    super();
    creados.push(this);
    if (ClienteFalso.demoraListo !== null) {
      setTimeout(() => {
        this.status = 'ready';
        this.emit('ready');
      }, ClienteFalso.demoraListo).unref?.();
    }
  }

  ping(): Promise<string> {
    this.pings++;
    // Igual que ioredis con `enableOfflineQueue: false`.
    if (this.status !== 'ready') {
      return Promise.reject(
        new Error(
          "Stream isn't writeable and enableOfflineQueue options is false",
        ),
      );
    }
    return Promise.resolve('PONG');
  }

  duplicate() {
    return new ClienteFalso();
  }

  disconnect() {
    this.desconectado = true;
    this.status = 'end';
  }
}

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => new ClienteFalso()),
}));

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => 'adaptador-falso'),
}));

// Se importa DESPUÉS de los mocks.
import { RedisIoAdapter, estadoDelPuente } from './realtime.redis';

describe('RedisIoAdapter contra un Redis que tarda en estar listo', () => {
  beforeEach(() => {
    creados.length = 0;
    ClienteFalso.demoraListo = 0;
    estadoDelPuente.conectado = false;
    delete estadoDelPuente.motivo;
  });

  const adaptador = () => new RedisIoAdapter({ get: () => undefined } as never);

  it('CONECTA aunque los clientes no estén listos al construirse', async () => {
    // EL FALLO DE STAGING: `ping()` justo después de construir el cliente se
    // rechazaba en el acto y el puente quedaba apagado contra una Redis sana.
    ClienteFalso.demoraListo = 5;

    await expect(adaptador().conectar({})).resolves.toBe(true);

    expect(estadoDelPuente.conectado).toBe(true);
    expect(estadoDelPuente.motivo).toBeUndefined();
    // Y no se malgastó ningún PING antes de tiempo.
    for (const c of creados) expect(c.pings).toBeLessThanOrEqual(1);
  });

  it('conecta también si ya estaban listos', async () => {
    ClienteFalso.demoraListo = 0;
    await expect(adaptador().conectar({})).resolves.toBe(true);
    expect(estadoDelPuente.conectado).toBe(true);
  });

  it('devuelve false y clasifica el motivo si Redis nunca llega', async () => {
    ClienteFalso.demoraListo = null;

    await expect(adaptador().conectar({}, 40)).resolves.toBe(false);

    expect(estadoDelPuente.conectado).toBe(false);
    expect(estadoDelPuente.motivo).toBe('redis-inalcanzable');
  });

  it('DESCONECTA los clientes cuando no puede abrir el puente', async () => {
    // Sin esto, ioredis seguiría reintentando para siempre en segundo plano:
    // una fuga silenciosa por cada arranque fallido.
    ClienteFalso.demoraListo = null;

    await adaptador().conectar({}, 40);

    expect(creados.length).toBeGreaterThan(0);
    for (const c of creados) expect(c.desconectado).toBe(true);
  });

  it('cerrar() desconecta y no deja clientes retenidos', async () => {
    ClienteFalso.demoraListo = 0;
    const a = adaptador();
    await a.conectar({});

    await a.cerrar();

    for (const c of creados) expect(c.desconectado).toBe(true);
  });

  it('dos adaptadores arrancando A LA VEZ no se estorban', async () => {
    // Backend y worker levantan a la vez en un `compose up`. Cada uno con sus
    // clientes: el resultado de uno no puede depender del otro.
    ClienteFalso.demoraListo = 5;

    const [uno, dos] = await Promise.all([
      adaptador().conectar({}),
      adaptador().conectar({}),
    ]);

    expect([uno, dos]).toEqual([true, true]);
    // Dos adaptadores × (pub + sub) = cuatro conexiones, ninguna compartida.
    expect(creados.length).toBe(4);
  });

  it('el estado del puente queda publicado para la monitorización', async () => {
    // Una degradación invisible es una degradación que dura semanas.
    ClienteFalso.demoraListo = null;
    await adaptador().conectar({}, 40);
    expect(estadoDelPuente).toEqual({
      conectado: false,
      motivo: 'redis-inalcanzable',
    });
  });
});
