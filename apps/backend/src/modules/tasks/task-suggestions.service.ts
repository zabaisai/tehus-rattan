import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TaskPriority, TaskSuggestionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** De dónde salió la propuesta. Sirve para saber qué regla propone basura. */
export type OrigenSugerencia =
  | 'flowbot'
  | 'automation'
  | 'rule'
  | 'agent'
  | 'system';

export interface DatosDeSugerencia {
  companyId: string;
  source: OrigenSugerencia;
  title: string;
  idempotencyKey: string;
  reason?: string;
  excerpt?: string;
  description?: string;
  priority?: TaskPriority;
  dueAt?: Date;
  suggestedAssignee?: string;
  contactId?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  flowBotId?: string | null;
}

/**
 * Cuánto texto del mensaje se guarda como justificación.
 *
 * Un extracto, no el hilo. La propuesta se enseña en listas y notificaciones,
 * y arrastrar la conversación entera copia datos personales a sitios donde no
 * hacen falta.
 */
const MAX_EXTRACTO = 280;

@Injectable()
export class TaskSuggestionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * ¿Esta empresa exige aprobación?
   *
   * Si no hay fila de configuración, la respuesta es SÍ. La ausencia de
   * configuración no puede significar «haz lo que quieras con la lista de
   * tareas de la gente»: el valor seguro es el que manda cuando nadie ha
   * decidido nada.
   */
  async exigeAprobacion(companyId: string): Promise<boolean> {
    const cfg = await this.prisma.companyLeadSettings.findUnique({
      where: { companyId },
      select: { requireTaskApproval: true },
    });
    return cfg?.requireTaskApproval ?? true;
  }

  /**
   * Registra una propuesta. Idempotente por `idempotencyKey`.
   *
   * Un reintento del worker sobre el mismo mensaje NO propone dos veces: el
   * asesor vería lo mismo duplicado sin saber cuál atender.
   */
  async proponer(datos: DatosDeSugerencia) {
    const titulo = datos.title?.trim();
    if (!titulo) {
      throw new BadRequestException('La propuesta necesita un título.');
    }

    try {
      return await this.prisma.taskSuggestion.create({
        data: {
          companyId: datos.companyId,
          source: datos.source,
          title: titulo.slice(0, 200),
          reason: datos.reason?.trim() || null,
          excerpt: datos.excerpt?.trim().slice(0, MAX_EXTRACTO) || null,
          description: datos.description?.trim() || null,
          priority: datos.priority ?? 'MEDIUM',
          dueAt: datos.dueAt,
          suggestedAssignee: datos.suggestedAssignee || null,
          contactId: datos.contactId || null,
          conversationId: datos.conversationId || null,
          leadId: datos.leadId || null,
          flowBotId: datos.flowBotId || null,
          idempotencyKey: datos.idempotencyKey,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Ya existía. Se devuelve la que hay: reintentar es normal, y fallar
        // haría que el worker lo intentara para siempre.
        const existente = await this.prisma.taskSuggestion.findUnique({
          where: { idempotencyKey: datos.idempotencyKey },
        });
        if (existente) return existente;
      }
      throw error;
    }
  }

  async listar(
    companyId: string,
    filtros: {
      estado?: TaskSuggestionStatus;
      contactId?: string;
      conversationId?: string;
      leadId?: string;
      limit?: number;
    } = {},
  ) {
    const take = Math.min(Math.max(filtros.limit ?? 50, 1), 100);
    return this.prisma.taskSuggestion.findMany({
      where: {
        companyId,
        ...(filtros.estado ? { status: filtros.estado } : {}),
        ...(filtros.contactId ? { contactId: filtros.contactId } : {}),
        ...(filtros.conversationId
          ? { conversationId: filtros.conversationId }
          : {}),
        ...(filtros.leadId ? { leadId: filtros.leadId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        suggestedUser: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  /**
   * APROBAR: la única puerta por la que nace una tarea real.
   *
   * Dos aprobaciones simultáneas crean UNA sola tarea. La transacción marca
   * primero la propuesta con `updateMany ... where status = PENDING`: solo una
   * de las dos obtiene `count = 1`, y solo esa sigue adelante. La otra se
   * encuentra la propuesta ya decidida y devuelve la tarea que ya existe, que
   * es lo que quien pulsó esperaba ver.
   *
   * El índice único sobre `createdTaskId` lo garantiza además en la base, por
   * si el código cambia.
   */
  async aprobar(
    id: string,
    companyId: string,
    actorUserId: string,
    ajustes: {
      title?: string;
      description?: string;
      priority?: TaskPriority;
      dueAt?: Date | null;
      assignedTo?: string | null;
      note?: string;
    } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const propuesta = await tx.taskSuggestion.findFirst({
        where: { id, companyId },
      });
      if (!propuesta) throw new NotFoundException('Propuesta no encontrada');

      if (propuesta.status !== 'PENDING') {
        // Ya decidida. Si fue una aprobación, se devuelve su tarea en vez de
        // un error: quien acaba de pulsar quiere ver el resultado.
        if (propuesta.status === 'APPROVED' && propuesta.createdTaskId) {
          const tarea = await tx.task.findUnique({
            where: { id: propuesta.createdTaskId },
          });
          return { propuesta, tarea, yaEstaba: true };
        }
        throw new ConflictException(
          `Esta propuesta ya fue ${this.enPalabras(propuesta.status)}.`,
        );
      }

      // El cierre de la carrera: solo una transacción cambia PENDING.
      const ganada = await tx.taskSuggestion.updateMany({
        where: { id, companyId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          decidedById: actorUserId,
          decidedAt: new Date(),
          decisionNote: ajustes.note?.trim() || null,
        },
      });
      if (ganada.count === 0) {
        throw new ConflictException(
          'Otra persona decidió esta propuesta al mismo tiempo. Vuelve a cargarla.',
        );
      }

      const tarea = await tx.task.create({
        data: {
          companyId,
          // El asesor puede corregir la propuesta antes de aceptarla: lo que
          // el bot sugiere es un borrador, no una orden.
          title: (ajustes.title ?? propuesta.title).trim().slice(0, 200),
          description: ajustes.description ?? propuesta.description,
          priority: ajustes.priority ?? propuesta.priority,
          dueDate:
            ajustes.dueAt !== undefined ? ajustes.dueAt : propuesta.dueAt,
          assignedTo:
            ajustes.assignedTo !== undefined
              ? ajustes.assignedTo
              : propuesta.suggestedAssignee,
          contactId: propuesta.contactId,
          conversationId: propuesta.conversationId,
          leadId: propuesta.leadId,
          status: 'PENDING',
        },
      });

      await tx.taskSuggestion.update({
        where: { id },
        data: { createdTaskId: tarea.id },
      });

      return {
        propuesta: { ...propuesta, status: 'APPROVED' },
        tarea,
        yaEstaba: false,
      };
    });
  }

  /** RECHAZAR: la propuesta muere y no nace ninguna tarea. */
  async rechazar(
    id: string,
    companyId: string,
    actorUserId: string,
    note?: string,
  ) {
    const existe = await this.prisma.taskSuggestion.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existe) throw new NotFoundException('Propuesta no encontrada');

    const cambiadas = await this.prisma.taskSuggestion.updateMany({
      where: { id, companyId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        decidedById: actorUserId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });

    if (cambiadas.count === 0) {
      throw new ConflictException(
        `Esta propuesta ya fue ${this.enPalabras(existe.status)}.`,
      );
    }
    return { rechazada: true };
  }

  /**
   * Caduca las propuestas que nadie atendió.
   *
   * Sin esto, una propuesta que ya no tiene sentido —el cliente cerró la
   * compra hace un mes— se queda PENDING para siempre ensuciando la bandeja,
   * y una bandeja con ruido deja de mirarse.
   */
  async caducarVencidas(
    companyId: string,
    antesDe: Date,
  ): Promise<{ caducadas: number }> {
    const r = await this.prisma.taskSuggestion.updateMany({
      where: { companyId, status: 'PENDING', createdAt: { lt: antesDe } },
      data: { status: 'EXPIRED', decidedAt: new Date() },
    });
    return { caducadas: r.count };
  }

  /** Cancelar: la propuesta deja de tener sentido por un hecho externo. */
  async cancelar(id: string, companyId: string, motivo?: string) {
    const cambiadas = await this.prisma.taskSuggestion.updateMany({
      where: { id, companyId, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        decidedAt: new Date(),
        decisionNote: motivo?.trim() || null,
      },
    });
    return { cancelada: cambiadas.count > 0 };
  }

  private enPalabras(estado: TaskSuggestionStatus): string {
    return (
      {
        PENDING: 'dejada pendiente',
        APPROVED: 'aprobada',
        REJECTED: 'rechazada',
        EXPIRED: 'caducada',
        CANCELLED: 'cancelada',
      }[estado] ?? estado
    );
  }
}
