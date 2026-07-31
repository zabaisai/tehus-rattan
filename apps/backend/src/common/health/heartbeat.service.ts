import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { isQueueWorker } from '../queue/queue.role';
import { RELEASE_INFO } from '../release/release.info';

/** Componente que late. Hoy solo el worker; el nombre queda abierto. */
export const COMPONENTE_WORKER = 'queue-worker';

/** Cada cuánto late. */
export const INTERVALO_LATIDO_MS = 30_000;

/**
 * Latido del worker de cola.
 *
 * POR QUÉ HACE FALTA: el worker no expone puerto, así que no hay endpoint que
 * sondear. Y preguntarle a Redis no sirve —Redis puede estar perfectamente y
 * el worker muerto, que es el caso peor de todos: los eventos se encolan,
 * nadie los consume, y tanto la API como Redis responden que están bien—.
 *
 * Late contra PostgreSQL y no contra Redis a propósito: si el latido viviera
 * en Redis, una caída de Redis borraría también la prueba de que el worker
 * había caído.
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  private fallosSeguidos = 0;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(INTERVALO_LATIDO_MS)
  async latir(): Promise<void> {
    // Solo late quien tiene algo que demostrar. El backend ya se observa por
    // HTTP; un latido suyo sería ruido.
    if (!isQueueWorker()) return;
    await this.registrar(COMPONENTE_WORKER);
  }

  async registrar(component: string): Promise<void> {
    const detail = { release: RELEASE_INFO.sha, pid: process.pid };

    try {
      await this.prisma.systemHeartbeat.upsert({
        where: { component },
        // `seenAt` es @updatedAt: Prisma lo pone solo. Se escribe `detail`
        // para forzar que la fila cambie y la marca avance.
        create: { component, detail },
        update: { detail },
      });
      this.fallosSeguidos = 0;
    } catch (error) {
      // No se relanza: que falle un latido no puede tumbar el worker ni
      // interrumpir el trabajo que sí está haciendo. Se registra en el
      // primer fallo y luego se calla, para no llenar el log si la base
      // está caída un rato largo.
      this.fallosSeguidos += 1;
      if (this.fallosSeguidos === 1) {
        this.logger.warn(
          `No se pudo registrar el latido [${
            error instanceof Error ? error.name : 'Error'
          }]`,
        );
      }
    }
  }
}
