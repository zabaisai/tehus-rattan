import {
  conTiempoLimite,
  ESPERA_MAXIMA_REDIS_MS,
  usaPuenteRedis,
} from './realtime.redis';

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
});
