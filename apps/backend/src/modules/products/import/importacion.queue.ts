import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  buildRedisConnection,
  QUEUE_NAMES,
} from '../../../common/queue/queue.config';
import { shouldEnqueue } from '../../../common/queue/queue.role';

export interface ImportacionJob {
  importId: string;
  companyId: string;
}

/**
 * Productor de la cola de importaciones.
 *
 * Una importacion de catalogo tarda minutos: hacerla dentro de la peticion
 * significa que el navegador espera hasta que el proxy corta la conexion, y
 * entonces nadie sabe si el trabajo siguio o no.
 *
 * Si la cola no esta disponible, el llamador procesa EN LINEA. Es mas lento y
 * ata la peticion, pero es mejor que aceptar un archivo y no procesarlo nunca:
 * el estado durable hace que se vea el progreso igual.
 */
@Injectable()
export class ImportacionQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(ImportacionQueue.name);
  private cola: Queue<ImportacionJob> | null = null;

  private obtenerCola(): Queue<ImportacionJob> {
    if (!this.cola) {
      this.cola = new Queue<ImportacionJob>(QUEUE_NAMES.PRODUCT_IMPORT, {
        connection: buildRedisConnection(),
        defaultJobOptions: {
          // Un reintento y espaciado: si el archivo esta roto, reintentarlo
          // cinco veces no lo arregla y ocupa el worker.
          attempts: 2,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      });
    }
    return this.cola;
  }

  isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return shouldEnqueue(env);
  }

  /**
   * Encola la importacion.
   *
   * `jobId` es el id de la importacion: encolar dos veces la misma produce UN
   * solo job, porque BullMQ descarta el duplicado.
   */
  async encolar(job: ImportacionJob): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      await this.obtenerCola().add(QUEUE_NAMES.PRODUCT_IMPORT, job, {
        jobId: job.importId,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar la importación ${job.importId}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }. Se procesará en línea.`,
      );
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.cola?.close().catch(() => undefined);
    this.cola = null;
  }
}
