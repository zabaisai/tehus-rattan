import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../../../common/outbox/outbox.handlers';
import { PrismaService } from '../../../prisma/prisma.service';
import { FlowBotQueueService } from './flowbot.queue';
import { OUTBOX_FLOWBOT } from './flowbot.runner';

/**
 * Publica los eventos de FlowBot desde el outbox hacia BullMQ.
 *
 * ES LA PIEZA QUE HACE QUE EL MOTOR SE MUEVA SOLO. El runner escribe el evento
 * en la misma transacción que la transición; esto lo recoge y lo convierte en
 * un trabajo de cola. Sin este eslabón, cada avance dependería de que alguien
 * —una prueba, un controlador— llamara al runner a mano.
 *
 * ORDEN INVIOLABLE, que impone el despachador:
 *
 *     persistir transición + outbox → commit → publicar → marcar outbox
 *
 * Nunca al revés. Marcar antes de publicar perdería el trabajo si la
 * publicación fallara, y ese es justo el fallo que el outbox existe para
 * evitar.
 *
 * ESTE SERVICIO NO MARCA NADA. Devuelve si pudo publicar y el despachador
 * decide: completar, o dejarlo pendiente con backoff.
 *
 * DUPLICADOS: el `jobId` es determinista y lo deriva la cola de
 * `(ejecución, paso, intento)` o de `waitId`. BullMQ descarta un `add` con un
 * id que ya existe SIN lanzar, así que reintentar la publicación del mismo
 * evento no crea un segundo trabajo. Es idempotente por construcción, no por
 * una comprobación previa que tendría su propia carrera.
 */

/**
 * Lo que lleva un evento de FlowBot.
 *
 * SOLO IDENTIFICADORES. Nunca el texto del cliente, ni tokens, ni cabeceras,
 * ni el grafo. El consumidor lo relee todo de PostgreSQL acotado por empresa:
 * así un payload viejo o manipulado no puede saltarse el aislamiento ni
 * resucitar un estado que ya cambió.
 */
export interface PayloadFlowBot {
  executionId?: string;
  companyId?: string;
  correlationId?: string;
  waitId?: string;
  /** Reanudación por mensaje: el ID, nunca el texto. */
  messageId?: string;
  paso?: number;
  wakeAt?: string;
}

/**
 * Estados desde los que ya no procede publicar un avance.
 *
 * `PAUSED` está aquí aunque no sea final: una ejecución pausada se reanuda por
 * `reanudar()`, que encola de nuevo. Publicar mientras está pausada solo
 * metería en la cola un trabajo que el lease rechazaría después.
 */
const NO_AVANZABLES = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'HANDED_OFF',
  'PAUSED',
];

@Injectable()
export class FlowBotOutboxPublisher implements OnModuleInit {
  private readonly logger = new Logger(FlowBotOutboxPublisher.name);

  /** Contadores para el health. Sin PII: solo cuántos y cuándo. */
  private publicados = 0;
  private descartados = 0;
  private ultimoDespacho: Date | null = null;

  constructor(
    private readonly registro: OutboxHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly cola: FlowBotQueueService,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(OUTBOX_FLOWBOT.AVANZAR, (e) =>
      this.publicarAvance(e.companyId, e.payload as PayloadFlowBot),
    );
    this.registro.registrar(OUTBOX_FLOWBOT.DESPERTAR, (e) =>
      this.publicarDespertar(e.companyId, e.payload as PayloadFlowBot),
    );
  }

  estado(): {
    publicados: number;
    descartados: number;
    ultimoDespacho: string | null;
  } {
    return {
      publicados: this.publicados,
      descartados: this.descartados,
      ultimoDespacho: this.ultimoDespacho?.toISOString() ?? null,
    };
  }

  /**
   * Publica un avance.
   *
   * Comprueba el estado ANTES de encolar: entre que el runner escribió el
   * evento y esto lo recoge pueden pasar segundos, y en ese hueco alguien pudo
   * cancelar o pausar. Un trabajo para algo que ya no debe avanzar es basura en
   * la cola que además ensucia las métricas de fallos.
   *
   * Descartar cuenta como despachado: no es un fallo de publicación, y dejar el
   * evento pendiente lo haría girar hasta agotar sus intentos y quedar FAILED,
   * ensuciando el panel con algo que funcionó exactamente como debía.
   */
  private async publicarAvance(
    companyIdEvento: string,
    payload: PayloadFlowBot,
  ): Promise<boolean> {
    if (!payload.executionId) return this.descartar('avance sin executionId');

    // El `companyId` del EVENTO manda sobre el del payload: el evento lo
    // escribió el outbox junto a la transición, el payload son solo datos.
    const ejecucion = await this.prisma.flowBotExecution.findFirst({
      where: { id: payload.executionId, companyId: companyIdEvento },
      select: {
        id: true,
        companyId: true,
        correlationId: true,
        steps: true,
        status: true,
      },
    });

    if (!ejecucion) {
      // Desapareció, o nunca fue de esta empresa. Reintentar no la va a
      // devolver.
      return this.descartar('ejecución inexistente');
    }
    if (NO_AVANZABLES.includes(ejecucion.status)) {
      return this.descartar(`ejecución en ${ejecucion.status}`);
    }

    const job = {
      tipo: 'avanzar' as const,
      companyId: ejecucion.companyId,
      executionId: ejecucion.id,
      correlationId: ejecucion.correlationId,
    };

    // Una reanudación por mensaje se identifica por el mensaje, no por el
    // paso: dos mensajes seguidos del mismo cliente están en el mismo paso y
    // compartirían `jobId`.
    if (payload.messageId) {
      return this.publicado(
        await this.cola.encolarMensaje({
          ...job,
          messageId: payload.messageId,
          waitId: payload.waitId,
        }),
      );
    }

    // El paso viene del payload y forma parte del `jobId`. Sin él, el segundo
    // avance de la misma ejecución se descartaría como duplicado del primero y
    // la ejecución se quedaría parada para siempre.
    return this.publicado(
      await this.cola.encolarAvance(job, payload.paso ?? ejecucion.steps),
    );
  }

  /**
   * Programa el despertar de una espera.
   *
   * Si la espera ya se consumió —el cliente contestó antes de que venciera— no
   * se encola nada. El consumidor volvería a comprobarlo contra PostgreSQL y lo
   * descartaría igual, pero hasta entonces el trabajo ocuparía sitio y, sobre
   * todo, dispararía un timeout que ya no corresponde.
   */
  private async publicarDespertar(
    companyIdEvento: string,
    payload: PayloadFlowBot,
  ): Promise<boolean> {
    if (!payload.waitId) return this.descartar('despertar sin waitId');

    const espera = await this.prisma.flowBotWait.findFirst({
      where: {
        id: payload.waitId,
        companyId: companyIdEvento,
        consumedAt: null,
      },
      select: {
        id: true,
        wakeAt: true,
        companyId: true,
        execution: { select: { id: true, status: true, correlationId: true } },
      },
    });

    if (!espera || !espera.wakeAt) {
      return this.descartar('espera consumida o sin vencimiento');
    }
    if (NO_AVANZABLES.includes(espera.execution.status)) {
      return this.descartar(`ejecución en ${espera.execution.status}`);
    }

    // El retraso lo calcula la cola desde `wakeAt`. Si ya pasó, sale 0 y el
    // trabajo se procesa de inmediato: es el caso de un despertar que se quedó
    // sin publicar mientras Redis estuvo caído.
    return this.publicado(
      await this.cola.encolarDespertar(
        {
          tipo: 'despertar',
          companyId: espera.companyId,
          executionId: espera.execution.id,
          waitId: espera.id,
          correlationId: espera.execution.correlationId,
        },
        espera.wakeAt,
      ),
    );
  }

  /** Se dio por despachado sin encolar. Cuenta aparte de lo publicado. */
  private descartar(motivo: string): boolean {
    this.descartados += 1;
    this.logger.debug(`Evento de FlowBot descartado: ${motivo}`);
    return true;
  }

  private publicado(ok: boolean): boolean {
    if (ok) {
      this.publicados += 1;
      this.ultimoDespacho = new Date();
    }
    return ok;
  }
}
