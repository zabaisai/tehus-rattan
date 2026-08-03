import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import {
  QUEUE_NAMES,
  buildRedisConnection,
} from '../../../common/queue/queue.config';
import { shouldConsumeQueue } from '../../../common/queue/queue.role';
import { PrismaService } from '../../../prisma/prisma.service';
import { GrafoCompilado } from '../graph/flowbot.compiler';
import { FlowBotJob } from './flowbot.queue';
import { FlowBotRunnerService } from './flowbot.runner';
import { FlowBotEffectsFactory } from './flowbot.effects.factory';

/**
 * Consumidor de la cola de FlowBot.
 *
 * Sigue el mismo patrón que `InboundProcessor`: se registra solo en el proceso
 * worker, no en el backend. Si se registrara en los dos, cada trabajo se
 * procesaría dos veces.
 *
 * NO CONFÍA EN EL CONTENIDO DEL TRABAJO. El job lleva identificadores; todo lo
 * demás se relee de PostgreSQL con el `companyId` acotado. Aunque el trabajo
 * venga de nuestra propia cola, un payload manipulado o simplemente viejo no
 * puede saltarse el aislamiento ni resucitar un estado que ya cambió.
 */
@Injectable()
export class FlowBotProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FlowBotProcessor.name);
  private worker: Worker<FlowBotJob> | null = null;

  /** Contadores para el health. Sin PII: solo cuántos. */
  private readonly metricas = {
    procesados: 0,
    fallidos: 0,
    omitidos: 0,
    ultimoEn: null as Date | null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: FlowBotRunnerService,
    private readonly efectos: FlowBotEffectsFactory,
  ) {}

  onModuleInit(): void {
    if (!shouldConsumeQueue()) {
      this.logger.log('Este proceso no consume la cola de FlowBot');
      return;
    }

    this.worker = new Worker<FlowBotJob>(
      QUEUE_NAMES.FLOWBOT,
      (job) => this.procesar(job),
      {
        connection: buildRedisConnection(),
        // Más bajo que la cola de entrantes: cada avance puede escribir varias
        // filas en una transacción, y el cuello de botella es PostgreSQL.
        concurrency: Number(process.env.FLOWBOT_CONCURRENCY ?? 3),
      },
    );

    this.worker.on('failed', (job, error) => {
      this.metricas.fallidos += 1;
      // Sin PII y sin el mensaje del proveedor: solo el clasificador.
      this.logger.error(
        `Trabajo de FlowBot fallido tras ${job?.attemptsMade ?? 0} intento(s) [${
          error?.name ?? 'Error'
        }] corr=${job?.data?.correlationId ?? '-'}`,
      );
    });

    this.logger.log('Consumidor de la cola de FlowBot iniciado');
  }

  /** Lo que publica el health agregado. Nunca datos de clientes. */
  estado(): {
    activo: boolean;
    procesados: number;
    fallidos: number;
    omitidos: number;
    ultimoEn: string | null;
  } {
    return {
      activo: this.worker !== null,
      procesados: this.metricas.procesados,
      fallidos: this.metricas.fallidos,
      omitidos: this.metricas.omitidos,
      ultimoEn: this.metricas.ultimoEn?.toISOString() ?? null,
    };
  }

  private async procesar(job: Job<FlowBotJob>): Promise<void> {
    const {
      companyId,
      executionId,
      waitId,
      messageId,
      correlationId,
      tipo,
      intento,
    } = job.data;

    if (!companyId || !executionId) {
      // Un payload sin identificadores no se puede procesar y reintentarlo no
      // lo va a arreglar: se descarta con constancia.
      this.logger.warn('Trabajo de FlowBot sin identificadores; descartado');
      this.metricas.omitidos += 1;
      return;
    }

    // Relectura acotada: el trabajo dice qué ejecución, la base dice si sigue
    // siendo de esa empresa y si todavía debe avanzar.
    const ejecucion = await this.prisma.flowBotExecution.findFirst({
      where: { id: executionId, companyId },
      select: { id: true, status: true },
    });

    if (!ejecucion) {
      // Desapareció, o el trabajo apuntaba a otra empresa. Reintentar no la
      // va a devolver.
      this.logger.warn(
        `Ejecución no encontrada al procesar [corr=${correlationId}]`,
      );
      this.metricas.omitidos += 1;
      return;
    }

    // La espera se pasa siempre que el trabajo la traiga: un despertar la
    // consume por vencimiento, un mensaje la consume como respuesta. Quien
    // decide cuál de las dos cosas es, mirando `wakeAt`, es el runner — y lo
    // hace con una escritura condicional, así que si ambos trabajos llegan a
    // la vez solo uno se la lleva.
    const opciones: { waitId?: string; entrada?: string; intento?: number } =
      {};
    if (waitId) opciones.waitId = waitId;
    // El nº de intento viaja en el trabajo porque no hay dónde guardarlo en la
    // ejecución. Si se perdiera, cada reintento se creería el primero y el
    // backoff no crecería nunca.
    if (intento) opciones.intento = intento;

    if (messageId) {
      // El texto se relee de PostgreSQL, no viaja en el trabajo. Si el mensaje
      // ya no está —borrado por retención, por ejemplo— se avanza sin entrada
      // en vez de fallar: la ejecución debe poder salir de su espera igual.
      const texto = await this.textoDelMensaje(messageId, companyId);
      if (texto !== null) opciones.entrada = texto;
    }

    const resultado = await this.runner.avanzarEjecucion(
      executionId,
      this.efectos.paraEmpresa(companyId),
      (versionId) => this.compiladoDe(versionId, companyId),
      opciones,
    );

    this.metricas.ultimoEn = new Date();
    if (resultado.estado === 'omitido') {
      this.metricas.omitidos += 1;
    } else {
      this.metricas.procesados += 1;
    }

    this.logger.debug(
      `FlowBot ${tipo} → ${resultado.estado} [corr=${correlationId}]`,
    );
  }

  /**
   * Lee el texto del mensaje que reanuda la ejecución.
   *
   * ACOTADO POR EMPRESA a través de la conversación. Un `messageId` de otra
   * empresa no puede convertirse en la entrada de este bot: es la misma razón
   * por la que el trabajo lleva el id y no el texto.
   */
  private async textoDelMensaje(
    messageId: string,
    companyId: string,
  ): Promise<string | null> {
    const mensaje = await this.prisma.message.findFirst({
      where: { id: messageId, conversation: { companyId } },
      select: { body: true },
    });
    return mensaje?.body ?? null;
  }

  /**
   * Carga el grafo compilado, comprobando que la versión pertenece a un bot de
   * ESTA empresa. Sin esa comprobación, un `versionId` de otra empresa
   * ejecutaría su flujo con los datos de esta.
   */
  private async compiladoDe(
    versionId: string,
    companyId: string,
  ): Promise<GrafoCompilado | null> {
    const version = await this.prisma.flowBotVersion.findFirst({
      where: { id: versionId, flowBot: { companyId } },
      select: { compiled: true },
    });
    return version ? (version.compiled as unknown as GrafoCompilado) : null;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      // Espera a que terminen los trabajos en vuelo: matarlos a mitad dejaría
      // ejecuciones con el lease tomado hasta que venciera.
      await this.worker.close();
      this.worker = null;
    }
  }
}
