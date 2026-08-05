import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { maskPhone } from '../../../common/logging/redact';
import { HandoffService } from '../../conversations/handoff.service';
import { FlowBotQueueService } from '../engine/flowbot.queue';
import { OUTBOX_FLOWBOT } from '../engine/flowbot.runner';
import {
  EjecucionDetalleDto,
  EjecucionResumenDto,
  EsperaDto,
  PaginaDto,
  PasoDto,
} from './flowbot.contracts';

/**
 * Consulta y operación de ejecuciones.
 *
 * DOS COSAS QUE NO SE NEGOCIAN AQUÍ:
 *
 * 1. LO QUE SALE VA REDACTADO. Esta pantalla la abre soporte y a veces se
 *    comparte en capturas. Nunca salen tokens, credenciales, cabeceras de
 *    autorización ni el teléfono completo del cliente.
 *
 * 2. LAS OPERACIONES SON ATÓMICAS Y CONDICIONALES. Cancelar, pausar y reanudar
 *    usan `updateMany` con el estado esperado en el `where`: si otra pestaña
 *    ya lo hizo, esta no lo repite ni pisa quién fue.
 */

/** Estados desde los que una ejecución todavía puede moverse. */
const VIVOS = ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] as const;

export interface FiltrosEjecucion {
  botId?: string;
  versionId?: string;
  estado?: string;
  contactId?: string;
  conversationId?: string;
  leadId?: string;
  assignedTo?: string;
  whatsappIntegrationId?: string;
  desde?: Date;
  hasta?: Date;
  conHandoff?: boolean;
  conError?: boolean;
  correlationId?: string;
}

@Injectable()
export class FlowBotExecutionsService {
  private readonly logger = new Logger(FlowBotExecutionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly cola: FlowBotQueueService,
    private readonly handoff: HandoffService,
  ) {}

  // ── listado con cursor ──────────────────────────────────────

  /**
   * Lista ejecuciones con paginación POR CURSOR.
   *
   * NO POR DESPLAZAMIENTO. Con `skip`, una ejecución nueva que entra mientras
   * alguien pagina desplaza todo y hace que la página 2 repita filas de la 1 o
   * se salte otras; y en la página 50 la base tiene que contar 5.000 filas para
   * descartarlas. El cursor es `(startedAt, id)`: estable aunque entren filas
   * nuevas, y siempre el mismo coste.
   *
   * El `id` desempata porque dos ejecuciones pueden empezar en el mismo
   * milisegundo, y sin él una de las dos se perdería entre páginas.
   */
  async listar(
    companyId: string,
    filtros: FiltrosEjecucion,
    paginacion: { cursor?: string; limite?: number } = {},
  ): Promise<PaginaDto<EjecucionResumenDto>> {
    const limite = Math.min(Math.max(paginacion.limite ?? 25, 1), 100);
    const cursor = this.leerCursor(paginacion.cursor);

    const where: Prisma.FlowBotExecutionWhereInput = {
      companyId,
      ...(filtros.botId ? { flowBotId: filtros.botId } : {}),
      ...(filtros.versionId ? { versionId: filtros.versionId } : {}),
      ...(filtros.estado
        ? { status: filtros.estado as Prisma.EnumFlowBotExecutionStatusFilter }
        : {}),
      ...(filtros.contactId ? { contactId: filtros.contactId } : {}),
      ...(filtros.conversationId
        ? { conversationId: filtros.conversationId }
        : {}),
      ...(filtros.leadId ? { leadId: filtros.leadId } : {}),
      ...(filtros.whatsappIntegrationId
        ? { whatsappIntegrationId: filtros.whatsappIntegrationId }
        : {}),
      ...(filtros.correlationId
        ? { correlationId: filtros.correlationId }
        : {}),
      ...(filtros.conError ? { errorCode: { not: null } } : {}),
      ...(filtros.assignedTo
        ? { conversation: { assignedTo: filtros.assignedTo } }
        : {}),
      ...(filtros.conHandoff
        ? { conversation: { handoffs: { some: { companyId } } } }
        : {}),
      ...(filtros.desde || filtros.hasta
        ? {
            startedAt: {
              ...(filtros.desde ? { gte: filtros.desde } : {}),
              ...(filtros.hasta ? { lte: filtros.hasta } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { startedAt: { lt: cursor.startedAt } },
              {
                startedAt: cursor.startedAt,
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    };

    // Se pide UNO MÁS del límite para saber si hay página siguiente sin tener
    // que contar el total, que en una tabla grande es la consulta cara.
    const filas = await this.prisma.flowBotExecution.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limite + 1,
      include: {
        flowBot: { select: { name: true } },
        version: { select: { version: true } },
        contact: { select: { phone: true, name: true } },
        conversation: {
          select: {
            assignedTo: true,
            handoffs: {
              where: { status: 'ACTIVE' },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });

    const hayMas = filas.length > limite;
    const items = (hayMas ? filas.slice(0, limite) : filas).map((e) =>
      this.aResumen(e),
    );
    const ultima = hayMas ? filas[limite - 1] : null;

    return {
      items,
      siguienteCursor: ultima
        ? this.escribirCursor(ultima.startedAt, ultima.id)
        : null,
    };
  }

  async detalle(
    companyId: string,
    executionId: string,
  ): Promise<EjecucionDetalleDto> {
    const e = await this.prisma.flowBotExecution.findFirst({
      where: { id: executionId, companyId },
      include: {
        flowBot: { select: { name: true } },
        version: { select: { version: true } },
        contact: { select: { phone: true, name: true } },
        conversation: {
          select: {
            assignedTo: true,
            handoffs: {
              orderBy: { startedAt: 'desc' },
              take: 1,
              include: { assignedTo: { select: { name: true } } },
            },
          },
        },
        executionSteps: { orderBy: { createdAt: 'asc' } },
        waits: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!e) throw new NotFoundException('Ejecución no encontrada');

    const handoff = e.conversation?.handoffs[0] ?? null;

    return {
      ...this.aResumen(e),
      variables: redactarVariables(e.variables),
      pasos_detalle: e.executionSteps.map(
        (p): PasoDto => ({
          id: p.id,
          nodeId: p.nodeId,
          nodeType: p.nodeType,
          estado: p.status,
          puertoSalida: p.outPort,
          errorCode: p.errorCode,
          duracionMs: p.durationMs,
          intento: p.attempt,
          meta: redactarVariables(p.output),
          en: p.createdAt.toISOString(),
        }),
      ),
      esperas: e.waits.map(
        (w): EsperaDto => ({
          id: w.id,
          tipo: w.kind,
          resumeNodeId: w.resumeNodeId,
          timeoutPort: w.timeoutPort,
          wakeAt: w.wakeAt?.toISOString() ?? null,
          consumidaEn: w.consumedAt?.toISOString() ?? null,
          eventKey: w.eventKey,
        }),
      ),
      handoff: handoff
        ? {
            id: handoff.id,
            estado: handoff.status,
            motivo: handoff.reason,
            asignadoA: handoff.assignedTo?.name ?? null,
            nodeId: handoff.nodeId,
            iniciadoEn: handoff.startedAt.toISOString(),
            resueltoEn: handoff.resolvedAt?.toISOString() ?? null,
          }
        : null,
      // Los efectos se deducen de los pasos: cada paso con efecto externo dice
      // qué hizo el bot. No hay tabla de efectos, y crearla duplicaría lo que
      // los pasos ya cuentan.
      efectos: e.executionSteps
        .filter((p) => p.outPort !== null || p.errorCode !== null)
        .map((p) => ({
          nodeId: p.nodeId,
          tipo: p.nodeType,
          resultado: p.errorCode ? `error:${p.errorCode}` : p.status,
        })),
    };
  }

  // ── operaciones ─────────────────────────────────────────────

  /**
   * Cancela una ejecución.
   *
   * Todo en una transacción: estado, lease y esperas. Si se hiciera en tres
   * pasos, morir en medio dejaría una ejecución cancelada con una espera viva
   * que al vencer intentaría despertarla — y aunque el consumidor lo
   * descartaría, el trabajo seguiría dando vueltas.
   *
   * El LEASE se limpia para que un worker que la tuviera no pueda seguir
   * avanzándola, y las esperas se consumen para que ningún job antiguo la
   * reviva.
   */
  async cancelar(
    companyId: string,
    userId: string,
    executionId: string,
    motivo: string,
  ) {
    const ahora = new Date();

    const [esperas, ejecucion] = await Promise.all([
      this.prisma.flowBotWait.findMany({
        where: { executionId, companyId, consumedAt: null },
        select: { id: true },
      }),
      this.prisma.flowBotExecution.findFirst({
        where: { id: executionId, companyId },
        select: { conversationId: true },
      }),
    ]);
    if (!ejecucion) throw new NotFoundException('Ejecución no encontrada');

    const resultado = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.flowBotExecution.updateMany({
        where: {
          id: executionId,
          companyId,
          // No se cancela lo que ya terminó: hacerlo reescribiría un final que
          // ya ocurrió y falsearía las métricas.
          status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
        },
        data: {
          status: 'CANCELLED',
          endedReason: `cancelada-por-usuario:${motivo}`.slice(0, 200),
          endedAt: ahora,
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      if (count === 0) return { cancelada: false };

      await tx.flowBotWait.updateMany({
        where: { executionId, companyId, consumedAt: null },
        data: { consumedAt: ahora },
      });

      // Rastro en la línea de tiempo: quién y por qué. Sin él, una ejecución
      // cancelada es indistinguible de una que falló.
      await tx.flowBotExecutionStep
        .create({
          data: {
            executionId,
            nodeId: 'operacion',
            nodeType: 'system.cancel',
            status: 'SKIPPED',
            outPort: 'cancelada',
            idempotencyKey: `cancel:${executionId}:${ahora.getTime()}`,
            output: { por: userId, motivo },
          },
        })
        .catch(() => undefined);

      return { cancelada: true };
    });

    // Retirar los despertares va FUERA: es best-effort contra Redis y no puede
    // hacer fallar una cancelación que ya está escrita.
    for (const e of esperas) await this.cola.cancelarDespertar(e.id);

    // Si esta ejecución había entregado la conversación, la entrega se cancela
    // —no se resuelve— porque nadie la atendió: mezclarlas haría imposible
    // medir cuántas entregas se quedaron sin respuesta. El bot NO se reanuda:
    // la ejecución que lo movía acaba de cancelarse.
    if (resultado.cancelada && ejecucion.conversationId) {
      await this.handoff
        .cancelar({
          companyId,
          conversationId: ejecucion.conversationId,
          reanudarBot: false,
        })
        .catch(() => undefined);
    }

    this.logger.log(
      `Ejecución ${executionId} cancelada por ${userId} [${motivo}]`,
    );
    return resultado;
  }

  /**
   * Pausa. No borra esperas ni estado: solo impide que empiece un paso nuevo.
   *
   * `tomarLease` del runner no acepta PAUSED, así que un job antiguo que
   * llegue después se descarta solo. No hace falta limpiar la cola.
   */
  async pausar(companyId: string, userId: string, executionId: string) {
    const { count } = await this.prisma.flowBotExecution.updateMany({
      where: { id: executionId, companyId, status: { in: [...VIVOS] } },
      data: { status: 'PAUSED', leaseOwner: null, leaseUntil: null },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Solo se puede pausar una ejecución en marcha o esperando',
      );
    }
    this.logger.log(`Ejecución ${executionId} pausada por ${userId}`);
    return { pausada: true };
  }

  /**
   * Reanuda desde PAUSED o NEEDS_ATTENTION.
   *
   * EL EVENTO VA POR OUTBOX, como todo lo demás: si el proceso muere entre el
   * commit y el encolado, el despachador lo publica igual. La clave lleva la
   * revisión de reanudación para que pulsar dos veces el botón no encole dos
   * trabajos.
   */
  async reanudar(companyId: string, userId: string, executionId: string) {
    const e = await this.prisma.flowBotExecution.findFirst({
      where: { id: executionId, companyId },
      select: { status: true, steps: true, correlationId: true },
    });
    if (!e) throw new NotFoundException('Ejecución no encontrada');

    if (e.status !== 'PAUSED' && e.status !== 'NEEDS_ATTENTION') {
      throw new BadRequestException(
        `No se puede reanudar una ejecución en estado ${e.status}`,
      );
    }

    const ahora = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.flowBotExecution.updateMany({
        where: {
          id: executionId,
          companyId,
          status: { in: ['PAUSED', 'NEEDS_ATTENTION'] },
        },
        data: {
          status: 'RUNNING',
          attentionReason: null,
          leaseOwner: null,
          leaseUntil: null,
        },
      });

      await this.outbox.record(tx, {
        type: OUTBOX_FLOWBOT.AVANZAR,
        companyId,
        idempotencyKey: `${OUTBOX_FLOWBOT.AVANZAR}:${executionId}:reanudar:${ahora}`,
        payload: {
          executionId,
          companyId,
          correlationId: e.correlationId,
          paso: e.steps,
        },
      });

      await tx.flowBotExecutionStep
        .create({
          data: {
            executionId,
            nodeId: 'operacion',
            nodeType: 'system.resume',
            status: 'SKIPPED',
            outPort: 'reanudada',
            idempotencyKey: `resume:${executionId}:${ahora}`,
            output: { por: userId, desde: e.status },
          },
        })
        .catch(() => undefined);
    });

    this.logger.log(`Ejecución ${executionId} reanudada por ${userId}`);
    return { reanudada: true, desde: e.status };
  }

  /**
   * Reintenta una ejecución fallida.
   *
   * SOLO SI SE PUEDE PROBAR QUE EL ÚLTIMO PASO NO PRODUJO SU EFECTO. Si el
   * último paso registrado falló ANTES de escribir su efecto —lo dice su
   * estado FAILED— reintentar es seguro, porque la clave de idempotencia
   * protege igualmente. Si el último paso quedó OK y aun así la ejecución
   * falló, el efecto ya ocurrió y reintentar podría mandar el mismo WhatsApp
   * dos veces: se pasa a NEEDS_ATTENTION y decide una persona.
   *
   * Es la misma regla que aplica el reconciliador a un lease vencido, y por la
   * misma razón.
   */
  async reintentar(companyId: string, userId: string, executionId: string) {
    const e = await this.prisma.flowBotExecution.findFirst({
      where: { id: executionId, companyId },
      select: {
        status: true,
        steps: true,
        correlationId: true,
        errorCode: true,
        executionSteps: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, nodeType: true },
        },
      },
    });
    if (!e) throw new NotFoundException('Ejecución no encontrada');

    if (e.status !== 'FAILED') {
      throw new BadRequestException(
        'Solo se puede reintentar una ejecución que falló',
      );
    }

    const ultimo = e.executionSteps[0];
    const efectoIncierto = ultimo?.status === 'OK';

    if (efectoIncierto) {
      await this.prisma.flowBotExecution.updateMany({
        where: { id: executionId, companyId, status: 'FAILED' },
        data: {
          status: 'NEEDS_ATTENTION',
          attentionReason: 'reintento-con-efecto-no-confirmado',
        },
      });
      this.logger.warn(
        `Reintento rechazado: el último paso de ${executionId} pudo producir su efecto`,
      );
      return {
        reintentada: false,
        estado: 'NEEDS_ATTENTION',
        motivo:
          'El último paso pudo haber enviado algo al cliente. Revísalo antes de reintentar.',
      };
    }

    await this.reanudarInterno(companyId, userId, executionId, e);
    return { reintentada: true, estado: 'RUNNING' };
  }

  private async reanudarInterno(
    companyId: string,
    userId: string,
    executionId: string,
    e: { steps: number; correlationId: string },
  ) {
    const ahora = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.flowBotExecution.updateMany({
        where: { id: executionId, companyId },
        data: {
          status: 'RUNNING',
          errorCode: null,
          endedAt: null,
          endedReason: null,
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      await this.outbox.record(tx, {
        type: OUTBOX_FLOWBOT.AVANZAR,
        companyId,
        idempotencyKey: `${OUTBOX_FLOWBOT.AVANZAR}:${executionId}:reintento:${ahora}`,
        payload: {
          executionId,
          companyId,
          correlationId: e.correlationId,
          paso: e.steps,
        },
      });
    });
    this.logger.log(`Ejecución ${executionId} reintentada por ${userId}`);
  }

  /** Fuerza la entrega a una persona desde la pantalla de ejecuciones. */
  async forzarHandoff(
    companyId: string,
    userId: string,
    executionId: string,
    entrada: { asignarA?: string; motivo?: string; nota?: string },
  ) {
    const e = await this.prisma.flowBotExecution.findFirst({
      where: { id: executionId, companyId },
      select: { conversationId: true, status: true },
    });
    if (!e) throw new NotFoundException('Ejecución no encontrada');
    if (!e.conversationId) {
      throw new BadRequestException(
        'Esta ejecución no está atada a una conversación',
      );
    }

    const r = await this.handoff.abrir({
      companyId,
      conversationId: e.conversationId,
      assignedToUserId: entrada.asignarA ?? null,
      reason: entrada.motivo ?? 'forzado-desde-ejecuciones',
      note: entrada.nota ?? null,
      executionId,
    });

    // La ejecución pasa a HANDED_OFF: `tomarLease` no acepta ese estado, así
    // que un job antiguo no puede seguir avanzándola por encima de la persona.
    await this.prisma.flowBotExecution.updateMany({
      where: { id: executionId, companyId, status: { in: [...VIVOS] } },
      data: {
        status: 'HANDED_OFF',
        endedReason: `handoff-forzado-por:${userId}`,
        endedAt: new Date(),
        leaseOwner: null,
        leaseUntil: null,
      },
    });

    return r;
  }

  // ── cursor ──────────────────────────────────────────────────

  private escribirCursor(startedAt: Date, id: string): string {
    return Buffer.from(`${startedAt.toISOString()}|${id}`).toString(
      'base64url',
    );
  }

  private leerCursor(cursor?: string): { startedAt: Date; id: string } | null {
    if (!cursor) return null;
    try {
      const [iso, id] = Buffer.from(cursor, 'base64url')
        .toString('utf8')
        .split('|');
      const startedAt = new Date(iso);
      if (!id || Number.isNaN(startedAt.getTime())) return null;
      return { startedAt, id };
    } catch {
      // Un cursor corrupto devuelve la primera página en vez de un error: es
      // lo que el usuario espera cuando pega una URL vieja.
      return null;
    }
  }

  private aResumen(e: {
    id: string;
    status: string;
    flowBotId: string;
    versionId: string;
    correlationId: string;
    conversationId: string | null;
    contactId: string | null;
    leadId: string | null;
    whatsappIntegrationId: string | null;
    steps: number;
    errorCode: string | null;
    endedReason: string | null;
    attentionReason: string | null;
    startedAt: Date;
    endedAt: Date | null;
    flowBot: { name: string };
    version?: { version: number } | null;
    contact?: { phone: string; name: string | null } | null;
    conversation?: {
      assignedTo: string | null;
      handoffs: Array<{ id: string }>;
    } | null;
  }): EjecucionResumenDto {
    return {
      id: e.id,
      estado: e.status,
      botId: e.flowBotId,
      botNombre: e.flowBot.name,
      versionId: e.versionId,
      version: e.version?.version ?? null,
      correlationId: e.correlationId,
      conversationId: e.conversationId,
      contactId: e.contactId,
      // El nombre si lo hay; el teléfono SIEMPRE enmascarado. Esta pantalla se
      // comparte en capturas de soporte.
      contacto: e.contact
        ? (e.contact.name ?? maskPhone(e.contact.phone))
        : null,
      leadId: e.leadId,
      asignadoA: e.conversation?.assignedTo ?? null,
      whatsappIntegrationId: e.whatsappIntegrationId,
      pasos: e.steps,
      errorCode: e.errorCode,
      motivoFin: e.endedReason,
      necesitaAtencion: e.status === 'NEEDS_ATTENTION',
      hayHandoff: (e.conversation?.handoffs.length ?? 0) > 0,
      iniciadaEn: e.startedAt.toISOString(),
      terminadaEn: e.endedAt?.toISOString() ?? null,
      duracionMs: e.endedAt
        ? e.endedAt.getTime() - e.startedAt.getTime()
        : null,
    };
  }
}

// ── redacción ───────────────────────────────────────────────────

/**
 * Claves cuyo VALOR nunca sale, mire lo que mire quien pregunta.
 *
 * Se compara por inclusión y en minúsculas porque nadie nombra las cosas
 * igual: `apiKey`, `api_key`, `API-KEY` y `authToken` son lo mismo para quien
 * las filtra, y una lista exacta se queda corta el día que alguien inventa
 * otro nombre.
 */
const CLAVES_SENSIBLES = [
  'token',
  'secret',
  'password',
  'contrasena',
  'apikey',
  'api_key',
  'authorization',
  'credential',
  'clave',
  'firma',
  'signature',
  'cookie',
];

export function redactarVariables(
  valor: unknown,
  profundidad = 0,
): Record<string, unknown> {
  if (profundidad > 6 || !valor || typeof valor !== 'object') {
    return {};
  }
  const salida: Record<string, unknown> = {};

  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    const normalizada = clave.toLowerCase().replace(/[-_]/g, '');
    if (
      CLAVES_SENSIBLES.some((s) => normalizada.includes(s.replace(/_/g, '')))
    ) {
      salida[clave] = '[oculto]';
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      salida[clave] = redactarVariables(v, profundidad + 1);
      continue;
    }
    if (typeof v === 'string') {
      // Un texto larguísimo en una variable suele ser el cuerpo de una
      // respuesta o el mensaje entero del cliente. Se recorta: la pantalla
      // explica el recorrido, no reproduce la conversación.
      salida[clave] = v.length > 300 ? `${v.slice(0, 300)}…` : v;
      continue;
    }
    salida[clave] = v;
  }
  return salida;
}
