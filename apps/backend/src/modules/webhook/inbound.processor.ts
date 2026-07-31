import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildRedisConnection,
  QUEUE_NAMES,
} from '../../common/queue/queue.config';
import { shouldConsumeQueue } from '../../common/queue/queue.role';
import type { InboundMessageJob } from '../../common/queue/inbound-queue.service';
import { WebhookService } from './webhook.service';

/**
 * Consumidor de la cola de mensajes entrantes.
 *
 * VIVE EN WebhookModule, no en QueueModule, y no es casual: necesita
 * `WebhookService`, y `WebhookModule` ya importa `QueueModule`. Ponerlo del
 * otro lado crearía una dependencia circular entre ambos módulos.
 *
 * SOLO ARRANCA EN EL WORKER. `shouldConsumeQueue()` lo garantiza: si el
 * backend también registrara un Worker, cada job correría dos veces —dos
 * automatizaciones, dos notificaciones, dos mensajes al cliente—. Como ambos
 * procesos comparten imagen y AppModule, es un error fácil de cometer y muy
 * difícil de diagnosticar, porque en desarrollo (donde solo corre un proceso)
 * nunca se manifiesta.
 */
@Injectable()
export class InboundProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InboundProcessor.name);
  private worker: Worker<InboundMessageJob> | null = null;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!shouldConsumeQueue()) {
      this.logger.log(
        'Este proceso no consume la cola de entrantes (solo produce)',
      );
      return;
    }

    this.worker = new Worker<InboundMessageJob>(
      QUEUE_NAMES.INBOUND,
      (job) => this.procesar(job),
      {
        connection: buildRedisConnection(),
        // Varios mensajes en paralelo, pero acotado: el cuello de botella real
        // son las llamadas salientes a Meta, no la CPU.
        concurrency: 5,
      },
    );

    // Un fallo se registra sin PII y el job permanece en la cola para poder
    // reejecutarlo (removeOnFail: false en las opciones por defecto).
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Job de entrante fallido tras ${job?.attemptsMade ?? 0} intento(s) [${
          error?.name ?? 'Error'
        }]`,
      );
    });

    this.logger.log('Consumidor de la cola de entrantes iniciado');
  }

  private async procesar(job: Job<InboundMessageJob>): Promise<void> {
    const { companyId, conversationId, body, contactPhone, messageId } =
      job.data;

    // `assignedTo` se resuelve AQUÍ, no se toma del job: entre el encolado y
    // el procesado un asesor pudo tomar la conversación, y notificar al
    // anterior sería un aviso a la persona equivocada.
    //
    // La lectura va acotada por companyId: aunque el job venga de nuestra
    // propia cola, no se confía en su contenido para saltarse el aislamiento.
    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      select: { assignedTo: true },
    });

    if (!conversacion) {
      // La conversación desapareció entre el encolado y el procesado. No es
      // un fallo recuperable: reintentar no la va a devolver.
      this.logger.warn(
        'Conversación no encontrada al procesar un entrante; job descartado',
      );
      return;
    }

    await this.webhookService.runInboundEffects(
      companyId,
      conversationId,
      body,
      contactPhone,
      conversacion.assignedTo ?? null,
      messageId,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      // Espera a que terminen los jobs en vuelo antes de cerrar. El compose
      // da 60s de gracia al worker justo para esto: matarlo a mitad haría que
      // el job se reintentara y pudiera duplicar efectos.
      await this.worker.close();
      this.worker = null;
    }
  }
}
