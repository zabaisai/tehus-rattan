import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import { buildRedisConnection } from '../queue/queue.config';

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
 * Cuánto se espera a Redis antes de arrancar sin puente.
 *
 * EXISTE POR UN FALLO REAL: sin límite, un `ping()` a un Redis inalcanzable
 * NO falla. ioredis encola el comando y reintenta la conexión para siempre,
 * así que el proceso se queda colgado a mitad del arranque —ni escucha, ni
 * responde al health, ni registra un error que explique por qué—. Es el peor
 * modo de fallo posible: parece un cuelgue sin causa.
 *
 * Tres segundos son de sobra para un Redis en la misma red de Docker, y a
 * cambio una máquina sin Redis arranca igual, solo que sin propagación entre
 * procesos.
 */
export const ESPERA_MAXIMA_REDIS_MS = 3_000;

/**
 * Estado del puente entre procesos, para que la monitorizacion lo vea.
 *
 * El tiempo real PUEDE degradarse a polling sin romper nada, pero esa
 * degradacion no debe ser invisible: si el puente lleva semanas caido, el
 * producto funciona "raro pero funciona" y nadie lo mira. Se publica aqui, en
 * el mismo modulo que lo abre, para que no haya dos verdades.
 */
export const estadoDelPuente: {
  conectado: boolean;
  /** Por que no esta conectado, ya clasificado. Nunca la cadena de conexion. */
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
    // en el acto en vez de quedarse guardado esperando un reintento.
    enableOfflineQueue: false,
    connectTimeout: ESPERA_MAXIMA_REDIS_MS,
  });
  // El suscriptor DEBE ser una conexión aparte: en modo subscribe, Redis no
  // acepta otros comandos por el mismo socket.
  const sub = pub.duplicate();
  return { pub, sub };
}

/**
 * Espera a que el cliente esté LISTO para aceptar comandos.
 *
 * EXISTE POR UN FALLO QUE LLEGÓ A STAGING. `ping()` se llamaba nada más
 * construir el cliente. ioredis conecta de forma asíncrona, así que el socket
 * todavía no era escribible y, con `enableOfflineQueue: false`, el comando se
 * rechazaba EN EL ACTO con "Stream isn't writeable". El resultado se
 * interpretaba como "Redis inalcanzable" y el puente quedaba desactivado en
 * TODOS los arranques, contra una Redis perfectamente sana —la misma que
 * BullMQ usaba sin problema, porque BullMQ sí espera a la conexión—.
 *
 * `enableOfflineQueue: false` se conserva a propósito: es lo que hace que un
 * comando posterior contra una Redis caída falle rápido en vez de quedarse
 * encolado para siempre. Lo que faltaba no era la cola, era esperar.
 *
 * Los escuchadores se retiran SIEMPRE al salir. Sin eso, cada arranque fallido
 * dejaría un `once('ready')` vivo sobre un cliente que ioredis sigue
 * reintentando, y una reconexión posterior resolvería una promesa que ya no
 * mira nadie.
 */
export function esperarListo(cliente: Redis): Promise<void> {
  // Ya está listo: no hay nada que esperar y suscribirse ahora significaría
  // esperar al SIGUIENTE 'ready', que quizá no llegue nunca.
  if (cliente.status === 'ready') return Promise.resolve();

  return new Promise<void>((resolver, rechazar) => {
    const limpiar = () => {
      cliente.removeListener('ready', alListo);
      cliente.removeListener('end', alCerrar);
    };
    const alListo = () => {
      limpiar();
      resolver();
    };
    // 'end' es el final de la vía: ioredis ya no reintenta. Sin escucharlo, la
    // espera se agotaría por tiempo cuando la respuesta ya se conoce.
    const alCerrar = () => {
      limpiar();
      rechazar(new Error('conexión cerrada'));
    };
    cliente.once('ready', alListo);
    cliente.once('end', alCerrar);
  });
}

/**
 * Resuelve a `false` si la comprobación no termina a tiempo, en vez de
 * quedarse esperando. El temporizador se limpia siempre: dejarlo vivo
 * mantendría el proceso despierto y un `docker stop` tardaría de más.
 */
export async function conTiempoLimite(
  tarea: Promise<unknown>,
  ms = ESPERA_MAXIMA_REDIS_MS,
): Promise<boolean> {
  let temporizador: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      tarea,
      new Promise((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error('timeout')),
          ms,
        ).unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/**
 * Comprobación completa del par de clientes: esperar a que ambos estén listos
 * y solo entonces hacer PING, todo dentro del mismo límite de tiempo.
 *
 * Se ofrece como una sola función porque el backend y el worker abren el
 * puente por caminos distintos y ANTES cada uno escribía su propia versión de
 * la comprobación. Dos copias de esta secuencia son dos oportunidades de
 * repetir exactamente el fallo que esto arregla.
 */
export async function puenteUtilizable(
  pub: Redis,
  sub: Redis,
  ms = ESPERA_MAXIMA_REDIS_MS,
): Promise<boolean> {
  return conTiempoLimite(
    (async () => {
      await Promise.all([esperarListo(pub), esperarListo(sub)]);
      await Promise.all([pub.ping(), sub.ping()]);
    })(),
    ms,
  );
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
