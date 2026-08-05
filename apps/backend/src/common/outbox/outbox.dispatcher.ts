import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  InboundQueueService,
  type InboundMessageJob,
} from '../queue/inbound-queue.service';
import { shouldEnqueue } from '../queue/queue.role';
import { OutboxService, OUTBOX_TYPES } from './outbox.service';
import { OutboxHandlerRegistry } from './outbox.handlers';

/**
 * Empuja los eventos del outbox a la cola.
 *
 * Corre en TODOS los procesos a propósito: si solo corriera en el worker, un
 * fallo del worker dejaría los eventos acumulándose sin que nadie los
 * despachara. La concurrencia es segura porque `claimBatch` usa
 * `FOR UPDATE SKIP LOCKED`: dos dispatchers se llevan filas distintas.
 *
 * Es deliberadamente tonto: solo mueve eventos de la base a la cola. Quien
 * ejecuta los efectos es el procesador del worker. Esa separación es la que
 * permite reintentar el despacho sin repetir los efectos.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private corriendo = false;
  private apagando = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly inboundQueue: InboundQueueService,
    private readonly registro: OutboxHandlerRegistry,
  ) {}

  /**
   * Cada 5 s. No es un cron: un intervalo corto mantiene la latencia añadida
   * por el outbox por debajo de lo que un asesor percibe, sin martillear la
   * base cuando no hay nada que hacer (el índice
   * `(status, availableAt)` hace que el lote vacío sea barato).
   */
  @Interval(5_000)
  async despachar(): Promise<void> {
    // Un solo pase a la vez por proceso: si el anterior aún corre, saltar.
    // Solaparse solo añadiría contención sobre las mismas filas.
    if (this.corriendo || this.apagando) return;
    if (!shouldEnqueue()) return;

    this.corriendo = true;
    try {
      const eventos = await this.outbox.claimBatch();
      if (eventos.length === 0) return;

      for (const evento of eventos) {
        if (this.apagando) break;
        await this.despacharUno(evento);
      }
    } catch (error) {
      // Un fallo aquí (base inaccesible) no debe tumbar el proceso: los
      // eventos siguen en la base y el siguiente pase los recogerá.
      this.logger.warn(
        `Pase del dispatcher fallido [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
    } finally {
      this.corriendo = false;
    }
  }

  private async despacharUno(evento: {
    id: string;
    type: string;
    companyId: string;
    payload: unknown;
    attempts: number;
  }): Promise<void> {
    try {
      // Los tipos que declara otro modulo se publican por su manejador. El
      // despachador no necesita conocerlos: solo que alguien sepa publicarlos.
      const manejador = this.registro.obtener(evento.type);
      if (manejador) {
        const publicado = await manejador(evento);
        if (!publicado) throw new Error('ColaNoDisponible');
        // Se marca DESPUES de que la cola confirme. Al reves se perderia el
        // trabajo si la publicacion fallara.
        await this.outbox.markCompleted(evento.id);
        return;
      }

      if (evento.type !== OUTBOX_TYPES.INBOUND_MESSAGE) {
        // Un tipo desconocido no se reintenta eternamente: se marca fallido
        // para que quede visible en vez de girar en el lote para siempre.
        throw new Error(`TipoDeEventoDesconocido`);
      }

      const encolado = await this.inboundQueue.enqueueInboundMessage(
        evento.payload as InboundMessageJob,
      );

      if (!encolado) {
        // Redis caído: el evento vuelve a PENDING con backoff y se reintenta.
        // NO se ejecuta en línea aquí: hacerlo desde el dispatcher rompería la
        // garantía de "un solo camino de ejecución" y podría duplicar efectos
        // si el enqueue sí había llegado a Redis antes de fallar la respuesta.
        throw new Error('ColaNoDisponible');
      }

      await this.outbox.markCompleted(evento.id);
    } catch (error) {
      // El tipo decide la política: cada evento tiene su propio equilibrio
      // entre insistir y rendirse.
      await this.outbox.markFailed(
        evento.id,
        evento.attempts,
        error,
        evento.type,
      );
    }
  }

  onApplicationShutdown(): void {
    // Deja de reclamar lotes nuevos. Los ya reclamados que no se procesen
    // quedan PROCESSING y los recupera el siguiente arranque por antigüedad
    // de `claimedAt`.
    this.apagando = true;
  }
}
