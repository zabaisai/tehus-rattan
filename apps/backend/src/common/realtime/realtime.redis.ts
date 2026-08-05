import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import { buildRedisConnection } from '../queue/queue.config';
import { ESPERA_MAXIMA_REDIS_MS, puenteUtilizable } from '../redis/redis-ready';

/**
 * ¿Hay que puentear el tiempo real por Redis?
 *
 * Se ata a la misma bandera que la cola porque describen el mismo hecho: si
 * hay Redis, hay más de un proceso; si no lo hay, todo corre en uno solo. Dos
 * banderas independientes solo servirían para dejarlas descuadradas y que el
 * worker emitiera al vacío sin que nadie se enterara.
 */
export function usaPuenteRedis(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QUEUE_ENABLED?.trim() !== 'false';
}

/**
 * La espera a que Redis esté lista vive en `common/redis/redis-ready.ts`, en
 * un solo sitio: el sondeo de la cola tenía este mismo fallo por otro camino.
 * Se reexporta para no romper a quien ya importaba desde aquí.
 */
export {
  ESPERA_MAXIMA_REDIS_MS,
  conTiempoLimite,
  esperarListo,
  puenteUtilizable,
} from '../redis/redis-ready';

/**
 * Estado del puente entre procesos, para que la monitorización lo vea.
 *
 * El tiempo real PUEDE degradarse a polling sin romper nada, pero esa
 * degradación no debe ser invisible: si el puente lleva semanas caído, el
 * producto funciona «raro pero funciona» y nadie lo mira. Se publica aquí, en
 * el mismo módulo que lo abre, para que no haya dos verdades.
 */
export const estadoDelPuente: {
  conectado: boolean;
  /** Por qué no está conectado, ya clasificado. Nunca la cadena de conexión. */
  motivo?: string;
} = { conectado: false };

/** Crea el par de conexiones que exige el adaptador (publicar y escuchar). */
export function crearClientesRedis(env: NodeJS.ProcessEnv = process.env): {
  pub: Redis;
  sub: Redis;
} {
  const pub = new Redis({
    ...buildRedisConnection(env),
    // Sin cola de espera: un comando enviado mientras no hay conexión falla
    // en el acto en vez de quedarse guardado esperando un reintento. La
    // espera a estar listo la resuelve `esperarListo`, no la cola offline.
    enableOfflineQueue: false,
    connectTimeout: ESPERA_MAXIMA_REDIS_MS,
  });
  // El suscriptor DEBE ser una conexión aparte: en modo subscribe, Redis no
  // acepta otros comandos por el mismo socket.
  const sub = pub.duplicate();
  return { pub, sub };
}

/**
 * Adaptador de socket.io con Redis por debajo.
 *
 * PARA QUÉ EXISTE
 *   El worker de la cola es OTRO proceso y no tiene servidor HTTP. Los
 *   clientes están conectados al backend. Sin este puente, cuando el worker
 *   termina de procesar un mensaje entrante y emite el evento, ese evento no
 *   llega a nadie: el asesor no ve la burbuja hasta el siguiente polling.
 *
 *   Con el adaptador, cualquier proceso que publique en Redis alcanza a los
 *   clientes conectados a cualquier otro. También es lo que permite escalar a
 *   varias réplicas de backend sin que un cliente deje de recibir lo suyo por
 *   estar conectado a la réplica equivocada.
 *
 * Si Redis no está disponible el backend arranca igual con el adaptador por
 * defecto: se pierde la propagación entre procesos, no el producto. El
 * frontend conserva polling justo para cubrir esa ventana.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adaptador?: ReturnType<typeof createAdapter>;
  private clientes: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /**
   * Devuelve `false` si no se pudo conectar, para poder seguir sin puente.
   * NUNCA bloquea el arranque más de `ESPERA_MAXIMA_REDIS_MS`: un backend que
   * no llega a escuchar es mucho peor que uno sin tiempo real.
   */
  async conectar(
    env: NodeJS.ProcessEnv = process.env,
    // Acotable desde las pruebas: esperar los 3 s reales por cada caso de
    // Redis-que-no-llega convertiría la suite en algo que nadie ejecuta.
    ms = ESPERA_MAXIMA_REDIS_MS,
  ): Promise<boolean> {
    const { pub, sub } = crearClientesRedis(env);
    this.clientes = [pub, sub];
    // Un fallo posterior de Redis no debe tumbar el proceso por un
    // 'error' sin escuchador; ioredis reconecta solo.
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);

    const conectado = await puenteUtilizable(pub, sub, ms);

    if (!conectado) {
      this.logger.warn(
        'Sin puente de Redis para tiempo real: los eventos del worker no llegarán en vivo (el polling los cubre)',
      );
      estadoDelPuente.conectado = false;
      estadoDelPuente.motivo = 'redis-inalcanzable';
      await this.cerrar();
      return false;
    }

    this.adaptador = createAdapter(pub, sub);
    estadoDelPuente.conectado = true;
    delete estadoDelPuente.motivo;
    return true;
  }

  async cerrar(): Promise<void> {
    await Promise.all(
      // `disconnect` y no `quit`: si nunca hubo conexión, `quit` se queda
      // esperando a poder enviar el comando.
      this.clientes.map((c) => {
        c.disconnect();
        return Promise.resolve();
      }),
    );
    this.clientes = [];
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (a: unknown) => void;
    };
    if (this.adaptador) server.adapter(this.adaptador);
    return server;
  }
}
