import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import {
  buildRedisConnection,
  QUEUE_NAMES,
} from '../../../common/queue/queue.config';
import { shouldConsumeQueue } from '../../../common/queue/queue.role';
import { ImportacionDeProductosService } from './importacion.service';
import { ImportacionJob } from './importacion.queue';

/**
 * Consumidor de la cola de importaciones. Vive en el WORKER.
 *
 * CONCURRENCIA 1 a proposito. Una importacion lee un archivo de disco y
 * escribe miles de filas; dos a la vez en el mismo proceso compiten por
 * memoria y por conexiones a la base, y lo que se gana en paralelismo se
 * pierde en que las dos van lentas. El limite por empresa ya esta en el
 * servicio; este es el limite del proceso.
 */
@Injectable()
export class ImportacionProcessor
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ImportacionProcessor.name);
  private worker: Worker<ImportacionJob> | null = null;

  constructor(private importaciones: ImportacionDeProductosService) {}

  onModuleInit(): void {
    if (!shouldConsumeQueue()) {
      this.logger.log(
        'Este proceso no consume la cola de importaciones (solo produce)',
      );
      return;
    }

    this.worker = new Worker<ImportacionJob>(
      QUEUE_NAMES.PRODUCT_IMPORT,
      (job) => this.procesar(job),
      {
        connection: buildRedisConnection(),
        concurrency: 1,
        // Un catalogo grande tarda minutos: el bloqueo tiene que durar mas que
        // el trabajo, o BullMQ dara el job por perdido y lo repartira a otro
        // worker mientras el primero sigue escribiendo.
        lockDuration: 10 * 60_000,
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Importación fallida tras ${job?.attemptsMade ?? 0} intento(s) [${
          error?.name ?? 'Error'
        }]`,
      );
    });

    this.logger.log('Consumidor de la cola de importaciones iniciado');
  }

  private async procesar(job: Job<ImportacionJob>): Promise<void> {
    // El servicio es reanudable: si esto es un reintento, arranca por donde se
    // quedo en vez de duplicar lo ya escrito.
    await this.importaciones.procesar(job.data.importId);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.worker = null;
  }
}
