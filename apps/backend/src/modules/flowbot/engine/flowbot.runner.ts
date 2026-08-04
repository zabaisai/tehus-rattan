import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { GrafoCompilado } from '../graph/flowbot.compiler';
import { LIMITES } from '../graph/flowbot.graph';
import { ContextoVariables } from '../graph/flowbot.variables';
import { Efectos } from './flowbot.ports';
import {
  EstadoEjecucion,
  MAX_INTENTOS,
  PasoRegistrado,
  ResultadoAvance,
  avanzar,
  esperaDeReintento,
} from './flowbot.interpreter';
import { FlowBotJob, FlowBotQueueService } from './flowbot.queue';

/**
 * Runner durable.
 *
 * ES LA PIEZA QUE CONVIERTE UN INTÉRPRETE CORRECTO EN UN SISTEMA QUE
 * SOBREVIVE. El intérprete decide; este servicio persiste lo decidido y
 * encola lo siguiente, de forma que un reinicio a mitad no pierda ni repita
 * trabajo.
 *
 * REGLA CENTRAL: PostgreSQL es la fuente de verdad. Nada importante existe
 * solo en Redis. El orden es siempre el mismo — persistir, luego encolar — y
 * nunca al revés: si se encolara primero, un fallo antes del commit dejaría un
 * trabajo apuntando a una ejecución que no existe.
 *
 * FUERA DE LA TRANSACCIÓN van los efectos externos (WhatsApp, HTTP, IA). Una
 * transacción abierta mientras se espera a Meta bloquea filas durante segundos
 * y agota el pool bajo carga.
 */

export const OUTBOX_FLOWBOT = {
  AVANZAR: 'flowbot.advance',
  DESPERTAR: 'flowbot.wake',
} as const;

/** Cuánto vale un lease antes de considerarse abandonado. */
export const LEASE_MS = 60_000;

export interface EventoArranque {
  companyId: string;
  flowBotId: string;
  versionId: string;
  /** Identifica el HECHO, no el intento: el `wamid`, el id del evento… */
  eventKey: string;
  conversationId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  whatsappIntegrationId?: string | null;
  triggerMessageId?: string | null;
  correlationId: string;
  /** Contexto inicial: contacto, empresa, oportunidad, número… */
  variables?: ContextoVariables;
  /** Encadenamiento entre bots y automatizaciones. */
  depth?: number;
}

export interface ResultadoArranque {
  executionId: string;
  /** `false` si ya existía: un webhook repetido no crea una segunda. */
  creada: boolean;
}

@Injectable()
export class FlowBotRunnerService {
  private readonly logger = new Logger(FlowBotRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly cola: FlowBotQueueService,
  ) {}

  // ── arranque ────────────────────────────────────────────────

  /**
   * Crea la ejecución UNA sola vez.
   *
   * La unicidad la garantiza el índice único de `idempotencyKey`, no un
   * «buscar y si no existe crear»: con dos workers simultáneos, ambos leerían
   * «no existe» antes de que ninguno escribiera. Aquí el segundo choca contra
   * la base y recupera la que creó el primero.
   *
   * En la MISMA transacción se escribe el evento de outbox. Si el proceso muere
   * después del commit y antes de encolar, el despachador del outbox lo publica
   * igual: por eso el trabajo no puede perderse.
   */
  async arrancar(evento: EventoArranque): Promise<ResultadoArranque> {
    const idempotencyKey = claveDeEjecucion(evento);

    // La recuperación del duplicado va FUERA de la transacción.
    //
    // En PostgreSQL, en cuanto una sentencia falla dentro de una transacción
    // esta queda abortada y rechaza cualquier consulta posterior con
    // «current transaction is aborted». Capturar el choque de unicidad DENTRO
    // y preguntar allí mismo por la fila existente no funciona: la consulta de
    // rescate falla también. Lo detectó una prueba contra la base real; en
    // memoria no se ve.
    try {
      const { executionId, creada } = await this.prisma.$transaction(
        async (tx) => {
          const ejecucion = await tx.flowBotExecution.create({
            data: {
              companyId: evento.companyId,
              flowBotId: evento.flowBotId,
              versionId: evento.versionId,
              conversationId: evento.conversationId ?? null,
              contactId: evento.contactId ?? null,
              leadId: evento.leadId ?? null,
              whatsappIntegrationId: evento.whatsappIntegrationId ?? null,
              triggerMessageId: evento.triggerMessageId ?? null,
              idempotencyKey,
              correlationId: evento.correlationId,
              depth: evento.depth ?? 0,
              status: 'RUNNING',
              variables: (evento.variables ?? {}) as Prisma.InputJsonValue,
            },
            select: { id: true },
          });

          await this.outbox.record(tx, {
            type: OUTBOX_FLOWBOT.AVANZAR,
            companyId: evento.companyId,
            // La clave del outbox identifica el hecho «hay que dar el paso 0
            // de esta ejecución», no el intento de publicarlo.
            idempotencyKey: `${OUTBOX_FLOWBOT.AVANZAR}:${ejecucion.id}:0`,
            payload: {
              executionId: ejecucion.id,
              companyId: evento.companyId,
              correlationId: evento.correlationId,
              paso: 0,
            },
          });

          return { executionId: ejecucion.id, creada: true };
        },
      );

      await this.cola.encolarAvance(
        {
          tipo: 'avanzar',
          companyId: evento.companyId,
          executionId,
          correlationId: evento.correlationId,
        },
        0,
      );
      this.logger.log(
        `Ejecución creada [bot=${evento.flowBotId} corr=${evento.correlationId}]`,
      );

      return { executionId, creada };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Otro proceso ganó la carrera. No es un fallo: es exactamente lo que
        // la clave de idempotencia existe para provocar.
        const existente = await this.prisma.flowBotExecution.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (existente) return { executionId: existente.id, creada: false };
      }
      throw error;
    }
  }

  // ── avance ──────────────────────────────────────────────────

  /**
   * Da un avance seguro. Es lo que ejecuta el consumidor de la cola.
   *
   * Toma un lease antes de tocar nada: dos trabajos para la misma ejecución
   * —un reintento de BullMQ y una continuación, por ejemplo— no pueden
   * avanzarla a la vez, o el cliente recibiría dos respuestas.
   */
  async avanzarEjecucion(
    executionId: string,
    efectos: Efectos,
    compiladoDe: (versionId: string) => Promise<GrafoCompilado | null>,
    opciones: {
      entrada?: string;
      waitId?: string;
      ahora?: Date;
      /** Nº de intento, cuando este trabajo es el reintento de un fallo. */
      intento?: number;
    } = {},
  ): Promise<{ estado: EstadoEjecucion | 'omitido'; motivo?: string }> {
    const ahora = opciones.ahora ?? new Date();
    const owner = `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

    const ejecucion = await this.tomarLease(executionId, owner, ahora);
    if (!ejecucion) {
      // O no existe, o ya terminó, o la tiene otro proceso. En los tres casos
      // lo correcto es no hacer nada: un trabajo viejo no puede revivir una
      // ejecución cancelada ni pisar a quien está trabajando.
      return { estado: 'omitido', motivo: 'sin lease' };
    }

    try {
      // UN AVANCE SUELTO NO PUEDE MOVER LO QUE ESTA ESPERANDO.
      //
      // Si la ejecucion esta en WAITING_* y el trabajo no trae la espera que
      // la desbloquea, no hay nada que hacer: el nodo que espera se volveria a
      // ejecutar y REPETIRIA LA PREGUNTA AL CLIENTE. Solo consumir la espera
      // —por mensaje o por vencimiento— o reanudar a mano pueden sacarla de
      // ahi.
      //
      // Lo provoca cualquier evento de avance repetido: un reintento tardio,
      // un reconciliador de una version anterior, o un duplicado del outbox.
      if (
        !opciones.waitId &&
        (ejecucion.status === 'WAITING_INPUT' ||
          ejecucion.status === 'WAITING_TIME')
      ) {
        await this.liberarLease(executionId, owner);
        return { estado: 'omitido', motivo: 'esperando entrada' };
      }

      const compilado = await compiladoDe(ejecucion.versionId);
      if (!compilado) {
        await this.marcarFallo(
          executionId,
          'version-ilegible',
          'configuracion',
        );
        return { estado: 'FAILED', motivo: 'version-ilegible' };
      }

      // Si venimos de una espera, se consume ANTES de avanzar y de forma
      // atómica: dos mensajes simultáneos no pueden consumir la misma.
      let porTimeout: { desdeNodo: string; puerto: string } | undefined;
      if (opciones.waitId) {
        const consumida = await this.consumirEspera(
          opciones.waitId,
          ejecucion.companyId,
          ahora,
        );
        if (!consumida) {
          await this.liberarLease(executionId, owner);
          return { estado: 'omitido', motivo: 'espera ya consumida' };
        }
        if (consumida.porVencimiento && consumida.timeoutPort) {
          porTimeout = {
            desdeNodo: consumida.resumeNodeId,
            puerto: consumida.timeoutPort,
          };
        }
      }

      const resultado = await avanzar(
        compilado,
        {
          companyId: ejecucion.companyId,
          executionId,
          correlationId: ejecucion.correlationId,
          conversationId: ejecucion.conversationId,
          contactId: ejecucion.contactId,
          leadId: ejecucion.leadId,
          whatsappIntegrationId: ejecucion.whatsappIntegrationId,
          currentNodeId: ejecucion.currentNodeId,
          variables: (ejecucion.variables ?? {}) as ContextoVariables,
          steps: ejecucion.steps,
          zonaHoraria: ejecucion.company?.timezone,
          entrada: opciones.entrada,
          porTimeout,
          intento: opciones.intento,
        },
        efectos,
        { maxPasos: LIMITES.MAX_PASOS_EJECUCION },
      );

      // UN FALLO REINTENTABLE NO ES UN ESTADO TERMINAL. Si se persistiera
      // FAILED, el trabajo del reintento llegaría y `tomarLease` lo rechazaría
      // —solo acepta estados vivos— así que el reintento no se ejecutaría
      // nunca. La ejecución sigue RUNNING con el `errorCode` anotado, y solo
      // pasa a FAILED cuando se agotan los intentos.
      const reintento = this.planDeReintento(resultado, opciones.intento ?? 1);

      await this.persistirAvance(ejecucion, resultado, ahora, reintento);
      await this.encolarSiguiente(ejecucion, resultado, reintento);

      return {
        estado: reintento ? 'RUNNING' : resultado.estado,
        motivo: resultado.motivo,
      };
    } finally {
      await this.liberarLease(executionId, owner);
    }
  }

  /**
   * Toma el lease con una escritura condicional.
   *
   * `updateMany` con el filtro dentro del `where` es atómico: o la fila cumple
   * las condiciones y se actualiza, o no se toca. Un `findFirst` seguido de un
   * `update` dejaría un hueco por el que otro worker se cuela.
   */
  private async tomarLease(executionId: string, owner: string, ahora: Date) {
    const limite = new Date(ahora.getTime() - LEASE_MS);

    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: {
        id: executionId,
        // Solo se avanza lo que está vivo. Una ejecución cancelada, terminada
        // o transferida a un humano no puede resucitar por un job antiguo.
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
        OR: [
          { leaseOwner: null },
          { leaseOwner: owner },
          // Lease caducado: quien lo tenía murió sin liberarlo.
          { leaseUntil: { lt: limite } },
        ],
      },
      data: {
        leaseOwner: owner,
        leaseUntil: new Date(ahora.getTime() + LEASE_MS),
      },
    });
    if (count === 0) return null;

    return this.prisma.flowBotExecution.findUnique({
      where: { id: executionId },
      select: {
        id: true,
        companyId: true,
        versionId: true,
        conversationId: true,
        contactId: true,
        leadId: true,
        whatsappIntegrationId: true,
        currentNodeId: true,
        variables: true,
        steps: true,
        correlationId: true,
        status: true,
        // La zona viaja con la ejecución para que el intérprete no tenga que
        // consultarla: un ejecutor no puede ver Prisma, y darle acceso para
        // esto se lo daría también a lo demás.
        company: { select: { timezone: true } },
      },
    });
  }

  private async liberarLease(executionId: string, owner: string) {
    // Solo libera SU lease: si otro ya lo tomó tras un vencimiento, quitárselo
    // dejaría a dos procesos trabajando a la vez.
    await this.prisma.flowBotExecution.updateMany({
      where: { id: executionId, leaseOwner: owner },
      data: { leaseOwner: null, leaseUntil: null },
    });
  }

  /**
   * Consume una espera de forma atómica.
   *
   * `updateMany` filtrando por `consumedAt: null` garantiza que solo una de
   * dos reanudaciones simultáneas se la lleve. La otra recibe `count === 0` y
   * se retira sin hacer nada.
   */
  private async consumirEspera(
    waitId: string,
    companyId: string,
    ahora: Date,
  ): Promise<{
    resumeNodeId: string;
    timeoutPort: string | null;
    porVencimiento: boolean;
  } | null> {
    const espera = await this.prisma.flowBotWait.findFirst({
      where: { id: waitId, companyId, consumedAt: null },
      select: { id: true, resumeNodeId: true, timeoutPort: true, wakeAt: true },
    });
    if (!espera) return null;

    const { count } = await this.prisma.flowBotWait.updateMany({
      where: { id: waitId, consumedAt: null },
      data: { consumedAt: ahora },
    });
    if (count === 0) return null;

    return {
      resumeNodeId: espera.resumeNodeId,
      timeoutPort: espera.timeoutPort,
      // Venció si su hora ya pasó. Si el cliente contestó antes, se reanuda
      // por la salida normal aunque el trabajo de vencimiento llegue después.
      porVencimiento: Boolean(espera.wakeAt && espera.wakeAt <= ahora),
    };
  }

  /**
   * Escribe pasos, estado, variables, espera y outbox EN UNA TRANSACCIÓN.
   *
   * Todo junto o nada: si se guardara el estado pero no la espera, la
   * ejecución quedaría dormida sin nada que la despierte.
   */
  /**
   * ¿Este fallo se reintenta, y cuándo?
   *
   * `null` si no hay reintento: o no falló, o el error no lo admite, o ya se
   * agotaron los intentos. En ese último caso la ejecución sí queda FAILED,
   * que es lo correcto: se probó y no salió.
   */
  private planDeReintento(
    resultado: ResultadoAvance,
    intentoActual: number,
  ): { siguiente: number; delayMs: number } | null {
    if (resultado.estado !== 'FAILED' || !resultado.reintentable) return null;
    if (intentoActual >= MAX_INTENTOS) return null;
    return {
      siguiente: intentoActual + 1,
      delayMs: esperaDeReintento(intentoActual),
    };
  }

  private async persistirAvance(
    ejecucion: { id: string; companyId: string; correlationId: string },
    resultado: ResultadoAvance,
    ahora: Date,
    reintento: { siguiente: number; delayMs: number } | null = null,
  ): Promise<void> {
    // Con reintento por delante la ejecución sigue viva: es la única forma de
    // que el trabajo del reintento pueda tomar el lease cuando llegue.
    const estado = reintento ? 'RUNNING' : resultado.estado;

    await this.prisma.$transaction(async (tx) => {
      for (const paso of resultado.pasos) {
        await this.guardarPaso(tx, ejecucion.id, paso, ahora);
      }

      await tx.flowBotExecution.update({
        where: { id: ejecucion.id },
        data: {
          status: estado,
          currentNodeId: resultado.currentNodeId,
          variables: resultado.variables as Prisma.InputJsonValue,
          steps: resultado.steps,
          lastStepAt: ahora,
          // El clasificador se anota aunque vaya a reintentarse: si el
          // reintento acaba saliendo, queda constancia de que costó.
          errorCode: resultado.errorCode ?? null,
          endedReason: reintento ? null : (resultado.motivo ?? null),
          ...(esFinal(estado) ? { endedAt: ahora } : {}),
        },
      });

      // El reintento va por outbox, como todo lo demás. Sin él, morir entre el
      // commit y el encolado dejaría la ejecución RUNNING sin nada que la
      // moviera — y aunque el reconciliador acabaría viéndola atascada, sería
      // cinco minutos después en vez de los segundos del backoff.
      if (reintento) {
        await this.outbox.record(tx, {
          type: OUTBOX_FLOWBOT.AVANZAR,
          companyId: ejecucion.companyId,
          idempotencyKey: `${OUTBOX_FLOWBOT.AVANZAR}:${ejecucion.id}:${resultado.steps}:reintento:${reintento.siguiente}`,
          payload: {
            executionId: ejecucion.id,
            companyId: ejecucion.companyId,
            correlationId: ejecucion.correlationId,
            paso: resultado.steps,
            intento: reintento.siguiente,
            delayMs: reintento.delayMs,
          },
        });
      }

      if (resultado.espera) {
        const espera = await tx.flowBotWait.create({
          data: {
            companyId: ejecucion.companyId,
            executionId: ejecucion.id,
            kind: resultado.espera.kind,
            wakeAt: resultado.espera.wakeAt ?? null,
            resumeNodeId: resultado.espera.resumeNodeId,
            timeoutPort: resultado.espera.timeoutPort ?? null,
            eventKey: resultado.espera.eventKey ?? null,
          },
          select: { id: true, wakeAt: true },
        });

        // El trabajo de despertar se publica por outbox: si el proceso muere
        // antes de encolarlo, el despachador lo hace igual. La espera ya está
        // en PostgreSQL, así que el reconciliador también podría reconstruirlo.
        if (espera.wakeAt) {
          await this.outbox.record(tx, {
            type: OUTBOX_FLOWBOT.DESPERTAR,
            companyId: ejecucion.companyId,
            idempotencyKey: `${OUTBOX_FLOWBOT.DESPERTAR}:${espera.id}`,
            payload: {
              executionId: ejecucion.id,
              companyId: ejecucion.companyId,
              waitId: espera.id,
              correlationId: ejecucion.correlationId,
              wakeAt: espera.wakeAt.toISOString(),
            },
          });
        }
      }

      // Un avance que se quedó a medio por el tope de tanda necesita otro
      // trabajo para seguir.
      if (resultado.estado === 'RUNNING') {
        await this.outbox.record(tx, {
          type: OUTBOX_FLOWBOT.AVANZAR,
          companyId: ejecucion.companyId,
          idempotencyKey: `${OUTBOX_FLOWBOT.AVANZAR}:${ejecucion.id}:${resultado.steps}`,
          payload: {
            executionId: ejecucion.id,
            companyId: ejecucion.companyId,
            correlationId: ejecucion.correlationId,
            paso: resultado.steps,
          },
        });
      }
    });
  }

  /**
   * Guarda un paso sin duplicarlo.
   *
   * La clave única es `ejecución:nodo:paso`. Un reintento de BullMQ del mismo
   * trabajo reejecutaría los mismos nodos; sin esta clave, el historial se
   * llenaría de pasos repetidos y las métricas contarían de más.
   */
  private async guardarPaso(
    tx: Prisma.TransactionClient,
    executionId: string,
    paso: PasoRegistrado,
    ahora: Date,
  ): Promise<void> {
    try {
      await tx.flowBotExecutionStep.create({
        data: {
          executionId,
          nodeId: paso.nodeId,
          nodeType: paso.nodeType,
          status: paso.estado,
          outPort: paso.puertoSalida ?? null,
          errorCode: paso.errorCode ?? null,
          durationMs: paso.durationMs,
          attempt: paso.intento,
          idempotencyKey: paso.idempotencyKey,
          // `meta` ya viene redactado por el ejecutor: nunca lleva tokens ni
          // el texto completo del cliente.
          output: (paso.meta ?? {}) as Prisma.InputJsonValue,
          createdAt: ahora,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Ya estaba: es un reintento del mismo trabajo. No es un fallo.
        return;
      }
      throw error;
    }
  }

  /** Encola lo siguiente. El outbox ya garantiza que no se pierda. */
  private async encolarSiguiente(
    ejecucion: { id: string; companyId: string; correlationId: string },
    resultado: ResultadoAvance,
    reintento: { siguiente: number; delayMs: number } | null = null,
  ): Promise<void> {
    const base: FlowBotJob = {
      tipo: 'avanzar',
      companyId: ejecucion.companyId,
      executionId: ejecucion.id,
      correlationId: ejecucion.correlationId,
    };

    if (reintento) {
      // El nº de intento entra en el `jobId`: sin él, el reintento se
      // descartaría como duplicado del avance que acaba de fallar.
      await this.cola.encolarAvance(
        { ...base, intento: reintento.siguiente },
        resultado.steps,
        { delayMs: reintento.delayMs },
      );
      return;
    }

    if (resultado.estado === 'RUNNING') {
      await this.cola.encolarAvance(base, resultado.steps);
    }
  }

  private async marcarFallo(
    executionId: string,
    errorCode: string,
    _clase: string,
  ): Promise<void> {
    await this.prisma.flowBotExecution.update({
      where: { id: executionId },
      data: { status: 'FAILED', errorCode, endedAt: new Date() },
    });
  }

  // ── control manual ──────────────────────────────────────────

  /**
   * Pausa. Un trabajo en vuelo no la revivirá: `tomarLease` solo acepta
   * estados vivos, y `PAUSED` no lo es.
   */
  async pausar(executionId: string, companyId: string): Promise<boolean> {
    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: {
        id: executionId,
        companyId,
        status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
      },
      data: { status: 'PAUSED' },
    });
    return count > 0;
  }

  async reanudar(executionId: string, companyId: string): Promise<boolean> {
    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: { id: executionId, companyId, status: 'PAUSED' },
      data: { status: 'RUNNING' },
    });
    if (count === 0) return false;

    const ejecucion = await this.prisma.flowBotExecution.findUnique({
      where: { id: executionId },
      select: { correlationId: true, steps: true },
    });
    await this.cola.encolarAvance(
      {
        tipo: 'avanzar',
        companyId,
        executionId,
        correlationId: ejecucion?.correlationId ?? executionId,
      },
      ejecucion?.steps ?? 0,
    );
    return true;
  }

  /**
   * Cancela y **consume sus esperas**. Dejarlas vivas haría que un trabajo de
   * vencimiento intentara despertar algo que ya no debe seguir.
   */
  async cancelar(
    executionId: string,
    companyId: string,
    motivo: string,
  ): Promise<boolean> {
    const ahora = new Date();
    const esperas = await this.prisma.flowBotWait.findMany({
      where: { executionId, companyId, consumedAt: null },
      select: { id: true },
    });

    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: {
        id: executionId,
        companyId,
        status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
      },
      data: {
        status: 'CANCELLED',
        endedReason: motivo,
        endedAt: ahora,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (count === 0) return false;

    await this.prisma.flowBotWait.updateMany({
      where: { executionId, consumedAt: null },
      data: { consumedAt: ahora },
    });
    for (const e of esperas) await this.cola.cancelarDespertar(e.id);

    return true;
  }
}

/** Estados que no admiten más avances. */
function esFinal(estado: EstadoEjecucion): boolean {
  return (
    estado === 'COMPLETED' ||
    estado === 'FAILED' ||
    estado === 'CANCELLED' ||
    estado === 'HANDED_OFF'
  );
}

/**
 * Clave de idempotencia del ARRANQUE.
 *
 * Lleva empresa, bot, versión y el hecho que lo disparó. La versión importa:
 * si el bot se republica, el mismo mensaje debe poder arrancar la versión
 * nueva sin chocar con la ejecución de la anterior.
 */
export function claveDeEjecucion(evento: {
  companyId: string;
  flowBotId: string;
  versionId: string;
  eventKey: string;
}): string {
  return `${evento.companyId}:${evento.flowBotId}:${evento.versionId}:${evento.eventKey}`;
}
