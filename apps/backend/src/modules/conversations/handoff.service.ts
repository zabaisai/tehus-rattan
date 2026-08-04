import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Entrega de una conversación a una persona.
 *
 * EL ESTADO VIVE EN POSTGRESQL, no en memoria ni en Redis. Un handoff que
 * solo existiera en el proceso desaparecería con el primer reinicio y el bot
 * volvería a contestar por encima del asesor — el fallo que más desconcierta
 * al cliente, porque de repente hay dos voces.
 *
 * TRANSICIONES PERMITIDAS, y ninguna más:
 *
 *     (nada) ──abrir──▶ ACTIVE ──resolver──▶ RESOLVED
 *                          │
 *                          └───cancelar───▶ CANCELLED
 *
 * No se puede reabrir una entrega resuelta: se abre otra. Un historial donde
 * la misma fila va y viene no permite contar cuántas veces hizo falta una
 * persona, que es justo lo que se quiere medir.
 *
 * UNA SOLA ACTIVA POR CONVERSACIÓN, garantizado por un índice único parcial
 * en la base. Dos nodos de handoff simultáneos —un reintento y una
 * continuación— dejarían dos filas activas, y resolver una no devolvería el
 * bot porque la otra seguiría viva.
 */

export interface AperturaHandoff {
  companyId: string;
  conversationId: string;
  /** Clasificador corto. Nunca el texto del cliente. */
  reason?: string | null;
  note?: string | null;
  assignedToUserId?: string | null;
  executionId?: string | null;
  nodeId?: string | null;
  taskId?: string | null;
}

export interface ResultadoHandoff {
  handoffId: string;
  /** `false` si ya había una activa: no es un fallo, es idempotencia. */
  creado: boolean;
  assignedToUserId: string | null;
}

@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Entrega la conversación.
   *
   * IDEMPOTENTE POR CONVERSACIÓN. Si ya hay una entrega activa devuelve esa,
   * sin crear otra ni cambiar a quién estaba asignada: un reintento del mismo
   * nodo no puede robarle la conversación al asesor que ya la tenía.
   *
   * La pausa y la fila se escriben en la MISMA transacción. Si se separaran,
   * morir en medio dejaría o bien una conversación pausada que nadie sabe por
   * qué lo está, o bien una entrega registrada con el bot todavía hablando.
   */
  async abrir(input: AperturaHandoff): Promise<ResultadoHandoff> {
    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, companyId: input.companyId },
      select: { id: true, assignedTo: true },
    });
    if (!conversacion) {
      throw new Error('ConversacionNoEncontrada');
    }

    const asignado = await this.usuarioDeLaEmpresa(
      input.companyId,
      input.assignedToUserId,
    );

    try {
      const handoff = await this.prisma.$transaction(async (tx) => {
        const creado = await tx.conversationHandoff.create({
          data: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            status: 'ACTIVE',
            reason: input.reason ?? null,
            note: input.note ?? null,
            // Si el nodo no dice a quién, se respeta quien ya tuviera la
            // conversación: alguien pudo tomarla a mano antes.
            assignedToUserId: asignado ?? conversacion.assignedTo ?? null,
            executionId: input.executionId ?? null,
            nodeId: input.nodeId ?? null,
            taskId: input.taskId ?? null,
          },
        });

        await tx.conversation.updateMany({
          where: { id: input.conversationId, companyId: input.companyId },
          data: {
            isPaused: true,
            ...(creado.assignedToUserId
              ? { assignedTo: creado.assignedToUserId }
              : {}),
          },
        });

        if (input.note) {
          await tx.note.create({
            data: {
              companyId: input.companyId,
              conversationId: input.conversationId,
              content: input.note,
            },
          });
        }

        return creado;
      });

      // El aviso va FUERA de la transacción y sin esperarlo: es best-effort.
      // Un fallo de notificaciones no puede deshacer una entrega que ya está
      // escrita, ni dejar al bot hablando mientras se reintenta.
      this.avisar(input.companyId, handoff.assignedToUserId, handoff.id, input);

      return {
        handoffId: handoff.id,
        creado: true,
        assignedToUserId: handoff.assignedToUserId,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Chocó contra el índice parcial: ya había una activa. Es exactamente
        // lo que ese índice existe para provocar.
        const existente = await this.activa(
          input.companyId,
          input.conversationId,
        );
        if (existente) {
          return {
            handoffId: existente.id,
            creado: false,
            assignedToUserId: existente.assignedToUserId,
          };
        }
      }
      throw error;
    }
  }

  /** La entrega activa de una conversación, si la hay. */
  async activa(companyId: string, conversationId: string) {
    return this.prisma.conversationHandoff.findFirst({
      where: { companyId, conversationId, status: 'ACTIVE' },
    });
  }

  /** ¿Está el bot silenciado por una persona en esta conversación? */
  async hayHandoffActivo(
    companyId: string,
    conversationId: string,
  ): Promise<boolean> {
    const n = await this.prisma.conversationHandoff.count({
      where: { companyId, conversationId, status: 'ACTIVE' },
    });
    return n > 0;
  }

  /**
   * La persona terminó: se devuelve la conversación al bot.
   *
   * `updateMany` con `status: 'ACTIVE'` en el `where`: si otra pestaña ya la
   * resolvió, esta no la vuelve a resolver ni pisa quién lo hizo.
   *
   * `reanudarBot` es una decisión de quien resuelve, no del sistema: muchas
   * veces la conversación termina con la persona y despertar al bot volvería a
   * escribirle al cliente sin motivo.
   */
  async resolver(input: {
    companyId: string;
    conversationId: string;
    resolvedByUserId?: string | null;
    reanudarBot?: boolean;
  }): Promise<{ resuelto: boolean; botReanudado: boolean }> {
    const reanudar = input.reanudarBot ?? false;

    const { count } = await this.prisma.conversationHandoff.updateMany({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        status: 'ACTIVE',
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedByUserId: input.resolvedByUserId ?? null,
      },
    });
    if (count === 0) return { resuelto: false, botReanudado: false };

    if (reanudar) {
      await this.prisma.conversation.updateMany({
        where: { id: input.conversationId, companyId: input.companyId },
        data: { isPaused: false },
      });
    }

    this.logger.log(
      `Handoff resuelto [conv=${input.conversationId}] bot=${
        reanudar ? 'reanudado' : 'sigue en pausa'
      }`,
    );
    return { resuelto: true, botReanudado: reanudar };
  }

  /**
   * Se retira sin haberse atendido: cancelación de la ejecución, cierre de la
   * conversación. Se distingue de `RESOLVED` porque medir «cuántas entregas
   * se quedaron sin respuesta» es imposible si ambas cosas son lo mismo.
   */
  async cancelar(input: {
    companyId: string;
    conversationId: string;
    reanudarBot?: boolean;
  }): Promise<{ cancelado: boolean }> {
    const { count } = await this.prisma.conversationHandoff.updateMany({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        status: 'ACTIVE',
      },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });

    if (count > 0 && input.reanudarBot) {
      await this.prisma.conversation.updateMany({
        where: { id: input.conversationId, companyId: input.companyId },
        data: { isPaused: false },
      });
    }
    return { cancelado: count > 0 };
  }

  /** Entregas activas, para la bandeja de quien supervisa. */
  async listarActivos(companyId: string, assignedToUserId?: string) {
    return this.prisma.conversationHandoff.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        ...(assignedToUserId ? { assignedToUserId } : {}),
      },
      orderBy: { startedAt: 'asc' },
      take: 200,
      include: {
        conversation: {
          select: {
            id: true,
            contact: { select: { id: true, name: true } },
          },
        },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  /** `null` si el usuario no es de esta empresa o está inactivo. */
  private async usuarioDeLaEmpresa(
    companyId: string,
    userId?: string | null,
  ): Promise<string | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  /**
   * Avisa a quien recibe la conversación.
   *
   * SIN CONTENIDO DEL CLIENTE: el aviso lleva el motivo clasificado, no lo que
   * escribió la persona. Un aviso llega a móviles y correos, y ahí el texto ya
   * no está protegido por los permisos del CRM.
   */
  private avisar(
    companyId: string,
    recipientUserId: string | null,
    handoffId: string,
    input: AperturaHandoff,
  ): void {
    if (!recipientUserId) return;
    void this.notifications
      .emit({
        companyId,
        recipientUserId,
        type: 'CONVERSATION_ASSIGNED',
        title: 'Una conversación necesita tu atención',
        bodyPreview: input.reason ? `Motivo: ${input.reason}` : undefined,
        entityType: 'Conversation',
        entityId: input.conversationId,
        actionUrl: `/dashboard/conversations`,
        // Un solo aviso por entrega: si el nodo se reintenta, el asesor no
        // recibe tres notificaciones de lo mismo.
        dedupeKey: `HANDOFF:${handoffId}`,
      })
      .catch(() => undefined);
  }
}
