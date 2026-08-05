import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { buildRedisConnection } from './queue.config';
import { pingCuandoListo } from '../redis/redis-ready';

/**
 * El sondeo se rinde antes que el arranque: un health que tarda 3 s en
 * responder es un health que nadie consulta. Sigue siendo mucho más que lo
 * que tarda una Redis sana en la misma red.
 */
export const ESPERA_SONDEO_MS = 2_000;

/**
 * Conexión de sondeo a Redis, separada de las conexiones de la cola.
 *
 * Es una conexión propia y perezosa a propósito: el health no debe competir
 * por la conexión que BullMQ usa para trabajar, ni mantenerla ocupada con
 * PINGs. Y al ser perezosa, el backend arranca aunque Redis no esté todavía
 * levantado — que es justo lo que pasa en el primer segundo de un despliegue.
 */
@Injectable()
export class QueuePingService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueuePingService.name);
  private cliente: Redis | null = null;

  private obtenerCliente(): Redis {
    if (!this.cliente) {
      this.cliente = new IORedis({
        ...buildRedisConnection(),
        lazyConnect: true,
        // El sondeo no debe reintentar eternamente: si Redis no está, la
        // respuesta correcta es "down", no quedarse colgado.
        retryStrategy: () => null,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      });
      // Sin listener de error, ioredis emite un 'error' no capturado que
      // tumbaría el proceso justo por lo que este servicio debe tolerar.
      this.cliente.on('error', (e) =>
        this.logger.debug(`Redis no disponible [${e.name}]`),
      );
    }
    return this.cliente;
  }

  /**
   * Devuelve la respuesta del PING, o lanza si Redis no está disponible.
   *
   * ESPERA A QUE EL CLIENTE ESTÉ LISTO. Antes se comprobaba solo `'end'` y
   * `'close'`, y se dejaba fuera `'wait'` — que es precisamente el estado
   * inicial de un cliente `lazyConnect`. El primer sondeo tras arrancar
   * pingueaba un socket sin abrir; con `enableOfflineQueue: false` eso se
   * rechaza en el acto y el health publicaba «cola caída» sobre una Redis
   * perfectamente disponible. Se veía en cada despliegue: un `degraded`
   * fugaz que desaparecía solo y que, por desaparecer solo, nadie
   * investigaba.
   *
   * La espera es la misma que usa el puente de tiempo real, importada del
   * mismo módulo: este fallo ya se arregló una vez en el otro camino.
   */
  async ping(): Promise<string> {
    return pingCuandoListo(this.obtenerCliente(), ESPERA_SONDEO_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cliente) {
      this.cliente.disconnect();
      this.cliente = null;
    }
  }
}
