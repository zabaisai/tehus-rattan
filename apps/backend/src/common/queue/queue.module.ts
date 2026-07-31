import { Global, Module } from '@nestjs/common';
import { QueueHealthService } from './queue.health';
import { QueuePingService } from './queue.ping';

/**
 * Módulo de la cola durable.
 *
 * Global porque la salud de la cola la consulta el controlador de health, y
 * más adelante los productores de jobs vivirán repartidos por varios módulos
 * de negocio: obligarlos a importar este módulo uno a uno solo añadiría
 * ceremonia.
 *
 * De momento expone únicamente la comprobación de salud. Los productores y
 * procesadores se enganchan en la siguiente fase, cuando el webhook pase a
 * encolar en vez de ejecutar en línea.
 */
@Global()
@Module({
  providers: [QueueHealthService, QueuePingService],
  exports: [QueueHealthService, QueuePingService],
})
export class QueueModule {}
