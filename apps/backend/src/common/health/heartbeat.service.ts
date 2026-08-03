import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { writeFileSync } from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { isQueueWorker } from '../queue/queue.role';
import { RELEASE_INFO } from '../release/release.info';

/** Componente que late. Hoy solo el worker; el nombre queda abierto. */
export const COMPONENTE_WORKER = 'queue-worker';

/** Cada cuánto late. */
export const INTERVALO_LATIDO_MS = 30_000;

/**
 * Edad máxima del fichero de latido antes de considerar muerto al worker.
 *
 * Dos intervalos y medio: tolera que un tic se pierda por una pausa del
 * recolector o un pico de carga, sin llegar a esconder un worker parado.
 */
export const LATIDO_MAXIMO_MS = INTERVALO_LATIDO_MS * 2.5;

/** Dónde se deja la marca local. Configurable para las pruebas. */
export function rutaDelLatido(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKER_HEARTBEAT_FILE?.trim() || '/tmp/worker-heartbeat';
}

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
export class HeartbeatService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HeartbeatService.name);
  private fallosSeguidos = 0;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(INTERVALO_LATIDO_MS)
  async latir(): Promise<void> {
    // Solo late quien tiene algo que demostrar. El backend ya se observa por
    // HTTP; un latido suyo sería ruido.
    if (!isQueueWorker()) return;

    // El fichero se toca ANTES y con independencia de la base: es la señal de
    // que ESTE PROCESO sigue vivo y su temporizador sigue corriendo. Si
    // dependiera de PostgreSQL, un parpadeo de la base marcaría enfermo a un
    // worker perfectamente sano — que es exactamente el error que este
    // fichero viene a corregir, solo que al revés.
    this.tocarFicheroDeLatido();

    await this.registrar(COMPONENTE_WORKER);
  }

  /** Se toca también al arrancar, para no quedar enfermo hasta el primer tic. */
  onApplicationBootstrap(): void {
    if (!isQueueWorker()) return;
    this.tocarFicheroDeLatido();
  }

  /**
   * Marca local para el healthcheck del contenedor.
   *
   * EXISTE PORQUE EL WORKER FIGURABA `unhealthy` SIN ESTARLO: heredaba el
   * HEALTHCHECK de la imagen del backend, que consulta `127.0.0.1:3001`, y el
   * worker no expone HTTP por diseño. Docker no lo reiniciaba —`restart:
   * unless-stopped` no actúa sobre la salud—, pero cualquiera que mirase la
   * monitorización leía lo contrario de la verdad.
   *
   * Un fichero y no una consulta: el healthcheck corre cada 30 s en un
   * contenedor aparte, y no debe abrir una conexión a la base cada vez.
   */
  private tocarFicheroDeLatido(): void {
    try {
      writeFileSync(rutaDelLatido(), String(Date.now()), { encoding: 'utf-8' });
    } catch {
      // Que no se pueda escribir el fichero no puede tumbar el worker. El
      // healthcheck lo verá envejecer y marcará enfermo, que es lo correcto:
      // algo va mal en el contenedor aunque el proceso siga en pie.
    }
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
