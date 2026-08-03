import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  buildRedisConnection,
} from '../../../common/queue/queue.config';
import { shouldEnqueue } from '../../../common/queue/queue.role';

/**
 * Qué hay que hacer con una ejecución.
 *
 * `avanzar` la mueve desde donde esté; `despertar` la reanuda por vencimiento
 * de una espera. Se distinguen porque despertar NO debe reejecutar el nodo que
 * estaba esperando —eso reenviaría la pregunta al cliente— sino salir por su
 * puerto de tiempo agotado.
 */
export interface FlowBotJob {
  tipo: 'avanzar' | 'despertar';
  companyId: string;
  executionId: string;
  /** Para `despertar`: qué espera venció. */
  waitId?: string;
  /**
   * Para una reanudación por mensaje: cuál lo provocó.
   *
   * Viaja el ID, NUNCA el texto. El consumidor relee el cuerpo de PostgreSQL
   * acotado por empresa: así el contenido del cliente no vive en Redis, donde
   * ni se cifra ni se borra con el mensaje, y un payload manipulado no puede
   * meterle palabras en la boca al cliente.
   */
  messageId?: string;
  /** Para correlacionar toda la cadena en los logs. */
  correlationId: string;
  /** Nº de reintento, para el backoff propio del motor. */
  intento?: number;
}

/**
 * Productor de la cola de FlowBot.
 *
 * REUTILIZA la infraestructura existente: mismo Redis, misma configuración de
 * conexión, mismas opciones por defecto. Solo cambia el nombre de la cola,
 * porque un atasco de ejecuciones de bots no debe frenar el procesamiento de
 * mensajes entrantes ni al revés.
 *
 * REDIS NO ES LA FUENTE DE VERDAD. Toda ejecución y toda espera viven en
 * PostgreSQL antes de encolarse. Si Redis se vacía, el reconciliador vuelve a
 * encolar lo que quedó pendiente: se pierde tiempo, nunca trabajo.
 */
@Injectable()
export class FlowBotQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(FlowBotQueueService.name);
  private cola: Queue<FlowBotJob> | null = null;

  private obtenerCola(): Queue<FlowBotJob> {
    if (!this.cola) {
      this.cola = new Queue<FlowBotJob>(QUEUE_NAMES.FLOWBOT, {
        connection: buildRedisConnection(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
    }
    return this.cola;
  }

  isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return shouldEnqueue(env);
  }

  /**
   * `jobId` DETERMINISTA.
   *
   * Se construye con la ejecución, el paso y el intento. BullMQ descarta un
   * `add` con un `jobId` que ya existe, así que dos productores concurrentes
   * —dos mensajes que llegan a la vez, un reintento del webhook— producen UN
   * solo trabajo.
   *
   * El número de paso importa: sin él, el segundo avance de la misma ejecución
   * se descartaría por duplicado y la ejecución se quedaría parada para
   * siempre. Es el mismo razonamiento que hace que la clave de idempotencia de
   * un efecto lleve el paso.
   */
  static jobIdAvance(executionId: string, paso: number, intento = 1): string {
    return `avanzar:${executionId}:${paso}:${intento}`;
  }

  static jobIdDespertar(waitId: string): string {
    // Una espera se consume UNA vez: su id basta y garantiza que dos
    // reconciliadores no encolen dos despertares para la misma.
    return `despertar:${waitId}`;
  }

  /**
   * `jobId` de una reanudación por mensaje.
   *
   * Lleva el MENSAJE y no el paso. Si llevara el paso, dos mensajes que el
   * cliente manda seguidos —«hola» y luego «¿hay alguien?»— compartirían id y
   * BullMQ descartaría el segundo como duplicado del primero. Con el id del
   * mensaje cada uno tiene su trabajo; el que llegue tarde se encontrará la
   * espera ya consumida y se retirará sin hacer nada.
   */
  static jobIdMensaje(executionId: string, messageId: string): string {
    return `mensaje:${executionId}:${messageId}`;
  }

  /** Encola un avance. `false` si no se pudo: el llamador decide qué hacer. */
  async encolarAvance(
    job: FlowBotJob,
    paso: number,
    opciones: { delayMs?: number } = {},
  ): Promise<boolean> {
    return this.encolar(
      job,
      FlowBotQueueService.jobIdAvance(job.executionId, paso, job.intento ?? 1),
      opciones.delayMs,
    );
  }

  /** Encola la reanudación que provoca un mensaje del cliente. */
  async encolarMensaje(job: FlowBotJob): Promise<boolean> {
    if (!job.messageId) return false;
    return this.encolar(
      job,
      FlowBotQueueService.jobIdMensaje(job.executionId, job.messageId),
    );
  }

  /** Encola un despertar para cuando venza la espera. */
  async encolarDespertar(job: FlowBotJob, wakeAt: Date): Promise<boolean> {
    if (!job.waitId) return false;
    // El retraso se calcula aquí y no se guarda: si el proceso muere antes de
    // encolar, el reconciliador lo detecta por `wakeAt` en PostgreSQL.
    const delayMs = Math.max(0, wakeAt.getTime() - Date.now());
    return this.encolar(
      job,
      FlowBotQueueService.jobIdDespertar(job.waitId),
      delayMs,
    );
  }

  /**
   * Retira el trabajo de una espera que se reanudó por otra vía.
   *
   * Sin esto, una espera con vencimiento que el cliente contesta a tiempo
   * dejaría su trabajo de despertar vivo, y al vencer intentaría sacar la
   * ejecución por el puerto de tiempo agotado cuando ya había seguido. El
   * consumidor también lo comprueba contra la base, así que esto es la primera
   * barrera y no la única.
   */
  async cancelarDespertar(waitId: string): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const trabajo = await this.obtenerCola().getJob(
        FlowBotQueueService.jobIdDespertar(waitId),
      );
      await trabajo?.remove();
    } catch (error) {
      // No es grave: el consumidor vuelve a comprobar el estado de la espera
      // en PostgreSQL antes de hacer nada.
      this.logger.debug(
        `No se pudo retirar el despertar [${clasificar(error)}]`,
      );
    }
  }

  private async encolar(
    job: FlowBotJob,
    jobId: string,
    delayMs?: number,
  ): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      await this.obtenerCola().add(QUEUE_NAMES.FLOWBOT, job, {
        jobId,
        ...(delayMs ? { delay: delayMs } : {}),
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar el trabajo de FlowBot [${clasificar(error)}]`,
      );
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cola) {
      await this.cola.close();
      this.cola = null;
    }
  }
}

/** Solo el tipo de error: la cadena de conexión nunca va al log. */
function clasificar(error: unknown): string {
  return error instanceof Error ? error.name || 'Error' : 'DesconocidoError';
}
