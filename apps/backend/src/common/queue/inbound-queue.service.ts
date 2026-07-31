import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  buildRedisConnection,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
} from './queue.config';
import { shouldEnqueue } from './queue.role';

/** Efectos diferidos de un mensaje entrante ya persistido. */
export interface InboundMessageJob {
  companyId: string;
  conversationId: string;
  messageId: string;
  /** Ya normalizado a E.164 por el webhook. */
  contactPhone: string;
  /** Texto para las automatizaciones; vacío en medios sin pie de foto. */
  body: string;
}

/**
 * Productor de la cola de entrantes.
 *
 * Lo que consigue: el webhook pasa a hacer solo persistir + encolar. Meta
 * exige un ack rápido y reintenta si tarda, así que ejecutar automatizaciones
 * y notificaciones dentro del handler es exactamente lo que provoca reintentos
 * y mensajes duplicados cuando una de esas acciones se ralentiza.
 *
 * Y separa fallos: hoy un error de automatización se traga en silencio dentro
 * del webhook. Como job, ese fallo queda visible, se reintenta con backoff y
 * permanece en la cola para poder reejecutarlo.
 */
@Injectable()
export class InboundQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(InboundQueueService.name);
  private cola: Queue<InboundMessageJob> | null = null;

  private obtenerCola(): Queue<InboundMessageJob> {
    if (!this.cola) {
      this.cola = new Queue<InboundMessageJob>(QUEUE_NAMES.INBOUND, {
        connection: buildRedisConnection(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
    }
    return this.cola;
  }

  /** ¿Está la cola activa? Si no, el llamador ejecuta en línea. */
  isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return shouldEnqueue(env);
  }

  /**
   * Encola los efectos de un mensaje entrante.
   *
   * IDEMPOTENCIA: `jobId` es el id del mensaje. Un reintento de Meta que
   * llegue a encolar dos veces produce UN solo job, porque BullMQ descarta el
   * duplicado por jobId. Es el mismo principio que ya protege `wamid` en la
   * persistencia, aplicado a los efectos.
   *
   * Devuelve `false` si no se pudo encolar, para que el llamador ejecute en
   * línea en vez de perder el trabajo. Un fallo de Redis NUNCA debe hacer que
   * un mensaje entrante se quede sin procesar.
   */
  async enqueueInboundMessage(job: InboundMessageJob): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      await this.obtenerCola().add(QUEUE_NAMES.INBOUND, job, {
        jobId: job.messageId,
      });
      return true;
    } catch (error) {
      // Sin PII y sin la cadena de conexión: solo el tipo de fallo.
      const clasificador =
        error instanceof Error ? error.name || 'Error' : 'DesconocidoError';
      this.logger.warn(
        `No se pudo encolar el mensaje entrante [${clasificador}]; se procesará en línea`,
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
