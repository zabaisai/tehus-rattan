import { EventEmitter } from 'events';
import type { Redis } from 'ioredis';
import {
  conTiempoLimite,
  esperarListo,
  ESPERA_MAXIMA_REDIS_MS,
  puenteUtilizable,
  usaPuenteRedis,
} from './realtime.redis';

/**
 * Doble de un cliente de ioredis.
 *
 * Reproduce lo que importa: `status` cambia con el tiempo, `ping()` RECHAZA
 * mientras no está listo —igual que ioredis con `enableOfflineQueue: false`—
 * y emite 'ready'/'end' como el de verdad. Un doble que aceptara `ping()`
 * siempre no podría reproducir el fallo que llegó a staging.
 */
class ClienteFalso extends EventEmitter {
  status: string;
  pings = 0;

  constructor(status = 'connecting') {
    super();
    this.status = status;
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

  /** Lo que hace ioredis al completar la conexión. */
  seVuelveListo() {
    this.status = 'ready';
    this.emit('ready');
  }

  /** Fin de la vía: ioredis ya no reintenta. */
  seCierra() {
    this.status = 'end';
    this.emit('end');
  }

  comoRedis(): Redis {
    return this as unknown as Redis;
  }
}

describe('puente de Redis para tiempo real', () => {
  describe('usaPuenteRedis', () => {
    it('está activo por defecto', () => {
      expect(usaPuenteRedis({})).toBe(true);
    });

    it('se apaga con la misma bandera que la cola', () => {
      // Describen el mismo hecho: si hay Redis, hay más de un proceso. Dos
      // banderas independientes solo servirían para dejarlas descuadradas y
      // que el worker emitiera al vacío sin que nadie se enterara.
      expect(usaPuenteRedis({ QUEUE_ENABLED: 'false' })).toBe(false);
      expect(usaPuenteRedis({ QUEUE_ENABLED: ' false ' })).toBe(false);
    });
  });

  describe('conTiempoLimite', () => {
    it('devuelve true si la tarea termina a tiempo', async () => {
      expect(await conTiempoLimite(Promise.resolve('ok'), 500)).toBe(true);
    });

    it('devuelve false si la tarea NUNCA termina, en vez de esperar siempre', async () => {
      // EL FALLO QUE ESTA PRUEBA GUARDA: un `ping` a un Redis inalcanzable no
      // falla —ioredis encola el comando y reintenta la conexión para
      // siempre—, así que sin límite el proceso se queda colgado a mitad del
      // arranque: ni escucha, ni responde al health, ni deja un error que
      // explique por qué. Es el peor modo de fallo posible.
      const jamas = new Promise(() => undefined);

      expect(await conTiempoLimite(jamas, 50)).toBe(false);
    });

    it('devuelve false si la tarea falla', async () => {
      expect(
        await conTiempoLimite(Promise.reject(new Error('caido')), 500),
      ).toBe(false);
    });

    it('no deja temporizadores que mantengan vivo el proceso', async () => {
      // Un temporizador sin limpiar haría que `docker stop` tardase de más y
      // acabase en SIGKILL.
      const antes = jest.getTimerCount?.() ?? 0;
      await conTiempoLimite(Promise.resolve('ok'), 10_000);
      const despues = jest.getTimerCount?.() ?? 0;

      expect(despues).toBeLessThanOrEqual(antes);
    });

    it('la espera por defecto es corta: arrancar importa más que el tiempo real', async () => {
      expect(ESPERA_MAXIMA_REDIS_MS).toBeLessThanOrEqual(5_000);
      expect(ESPERA_MAXIMA_REDIS_MS).toBeGreaterThan(0);
    });
  });

  describe('esperarListo', () => {
    it('con el cliente YA listo no espera a nada', async () => {
      const c = new ClienteFalso('ready');
      // Suscribirse aquí significaría esperar al SIGUIENTE 'ready', que en una
      // conexión sana no llega nunca: el arranque se agotaría por tiempo.
      await expect(esperarListo(c.comoRedis())).resolves.toBeUndefined();
      expect(c.listenerCount('ready')).toBe(0);
    });

    it('espera al evento cuando aún no está listo', async () => {
      const c = new ClienteFalso('connecting');
      const espera = esperarListo(c.comoRedis());

      expect(c.listenerCount('ready')).toBe(1);
      c.seVuelveListo();

      await expect(espera).resolves.toBeUndefined();
    });

    it('falla en cuanto la conexión se cierra, sin agotar el tiempo', async () => {
      // 'end' es el final de la vía: ioredis ya no reintenta. Esperar los 3
      // segundos completos cuando la respuesta ya se conoce solo retrasa el
      // arranque.
      const c = new ClienteFalso('connecting');
      const espera = esperarListo(c.comoRedis());
      c.seCierra();

      await expect(espera).rejects.toThrow(/cerrada/i);
    });

    it('RETIRA sus escuchadores al resolver', async () => {
      const c = new ClienteFalso('connecting');
      const espera = esperarListo(c.comoRedis());
      c.seVuelveListo();
      await espera;

      // Sin esto, cada arranque fallido dejaría un escuchador vivo sobre un
      // cliente que ioredis sigue reintentando.
      expect(c.listenerCount('ready')).toBe(0);
      expect(c.listenerCount('end')).toBe(0);
    });

    it('RETIRA sus escuchadores también al fallar', async () => {
      const c = new ClienteFalso('connecting');
      const espera = esperarListo(c.comoRedis()).catch(() => undefined);
      c.seCierra();
      await espera;

      expect(c.listenerCount('ready')).toBe(0);
      expect(c.listenerCount('end')).toBe(0);
    });
  });

  describe('puenteUtilizable', () => {
    it('REDIS ALCANZABLE PERO AÚN NO LISTA: espera y conecta (el fallo de staging)', async () => {
      // ESTE ES EL CASO QUE LLEGÓ A STAGING. `ping()` se llamaba nada más
      // construir el cliente; con `enableOfflineQueue: false` ioredis lo
      // rechazaba en el acto con "Stream isn't writeable", y eso se leía como
      // "Redis inalcanzable" contra una Redis perfectamente sana. El puente
      // quedaba desactivado en TODOS los arranques.
      const pub = new ClienteFalso('connecting');
      const sub = new ClienteFalso('connecting');

      const resultado = puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 500);
      // Todavía no se ha hecho ningún PING: primero hay que estar listo.
      expect(pub.pings).toBe(0);
      expect(sub.pings).toBe(0);

      pub.seVuelveListo();
      sub.seVuelveListo();

      await expect(resultado).resolves.toBe(true);
      expect(pub.pings).toBe(1);
      expect(sub.pings).toBe(1);
    });

    it('REDIS LISTA: conecta sin esperar', async () => {
      const pub = new ClienteFalso('ready');
      const sub = new ClienteFalso('ready');

      await expect(
        puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 500),
      ).resolves.toBe(true);
    });

    it('REDIS INALCANZABLE: devuelve false sin colgar el arranque', async () => {
      const pub = new ClienteFalso('connecting');
      const sub = new ClienteFalso('connecting');
      // ioredis agota los reintentos y cierra.
      setTimeout(() => {
        pub.seCierra();
        sub.seCierra();
      }, 10);

      await expect(
        puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 500),
      ).resolves.toBe(false);
    });

    it('TIMEOUT: si nunca llega a estar lista, se rinde a tiempo', async () => {
      // Ni 'ready' ni 'end': el caso de una Redis que ni responde ni cierra.
      const pub = new ClienteFalso('connecting');
      const sub = new ClienteFalso('connecting');

      const inicio = Date.now();
      await expect(
        puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 50),
      ).resolves.toBe(false);
      expect(Date.now() - inicio).toBeLessThan(1_000);
    });

    it('basta con que UNO de los dos clientes no llegue para no abrir el puente', async () => {
      // El adaptador necesita los dos: con uno solo, publicaría sin escuchar.
      const pub = new ClienteFalso('ready');
      const sub = new ClienteFalso('connecting');

      await expect(
        puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 50),
      ).resolves.toBe(false);
    });

    it('no deja escuchadores colgando tras un intento fallido', async () => {
      const pub = new ClienteFalso('connecting');
      const sub = new ClienteFalso('connecting');

      await puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 30);

      // Tras el timeout la promesa de espera sigue viva por dentro; lo que no
      // puede quedar es un escuchador por intento acumulándose en el cliente.
      expect(pub.listenerCount('ready')).toBeLessThanOrEqual(1);
      expect(sub.listenerCount('ready')).toBeLessThanOrEqual(1);
    });

    it('arranques SIMULTÁNEOS (backend y worker) no se pisan', async () => {
      // Backend y worker abren el puente por caminos distintos y a la vez.
      // Cada uno con sus propios clientes: ninguno debe depender del orden en
      // que el otro llegue a estar listo.
      const a = { pub: new ClienteFalso(), sub: new ClienteFalso() };
      const b = { pub: new ClienteFalso(), sub: new ClienteFalso() };

      const puenteA = puenteUtilizable(
        a.pub.comoRedis(),
        a.sub.comoRedis(),
        500,
      );
      const puenteB = puenteUtilizable(
        b.pub.comoRedis(),
        b.sub.comoRedis(),
        500,
      );

      // Se vuelven listos entrelazados y en orden distinto al de creación.
      b.sub.seVuelveListo();
      a.pub.seVuelveListo();
      b.pub.seVuelveListo();
      a.sub.seVuelveListo();

      await expect(Promise.all([puenteA, puenteB])).resolves.toEqual([
        true,
        true,
      ]);
    });

    it('un PING que falla con la conexión ya lista tampoco abre el puente', async () => {
      const pub = new ClienteFalso('ready');
      const sub = new ClienteFalso('ready');
      jest.spyOn(pub, 'ping').mockRejectedValue(new Error('READONLY replica'));

      await expect(
        puenteUtilizable(pub.comoRedis(), sub.comoRedis(), 500),
      ).resolves.toBe(false);
    });
  });
});
