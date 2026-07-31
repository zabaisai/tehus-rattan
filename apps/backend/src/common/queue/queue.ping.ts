import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { buildRedisConnection } from './queue.config';

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

  /** Devuelve la respuesta del PING, o lanza si Redis no está disponible. */
  async ping(): Promise<string> {
    const cliente = this.obtenerCliente();
    if (cliente.status === 'end' || cliente.status === 'close') {
      await cliente.connect();
    }
    return cliente.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cliente) {
      this.cliente.disconnect();
      this.cliente = null;
    }
  }
}
