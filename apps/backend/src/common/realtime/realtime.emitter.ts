import { Injectable, Logger } from '@nestjs/common';
import { EVENTS, rooms } from './realtime.rooms';
import { RealtimeTransport } from './realtime.transport';

/**
 * Emisor de eventos de tiempo real.
 *
 * Envuelve al gateway por dos razones:
 *
 *  1. TODA emisión pasa por aquí, así que el `companyId` de la sala se puede
 *     auditar en un único sitio. Emitir directamente desde cada servicio
 *     dispersaría la decisión de "a quién llega esto" por todo el código.
 *  2. Es best-effort: un fallo al emitir NUNCA debe romper la operación de
 *     negocio que lo originó. Que un asesor no vea la burbuja aparecer sola
 *     es una molestia; que el mensaje no se guarde es un incidente. El
 *     frontend conserva polling como respaldo justo para esto.
 */
@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);

  constructor(private readonly transport: RealtimeTransport) {}

  /** A todos los conectados de una empresa. */
  toCompany(companyId: string, event: string, payload: unknown): void {
    this.emit(rooms.company(companyId), event, payload);
  }

  /** A un usuario concreto, en todas sus pestañas. */
  toUser(userId: string, event: string, payload: unknown): void {
    this.emit(rooms.user(userId), event, payload);
  }

  /** A quienes tienen abierto ese hilo. */
  toConversation(
    companyId: string,
    conversationId: string,
    event: string,
    payload: unknown,
  ): void {
    this.emit(rooms.conversation(companyId, conversationId), event, payload);
  }

  // ── Atajos con la forma de payload ya fijada ────────────────
  // Existen para que el contrato de cada evento viva en un sitio y no se
  // reinvente en cada llamador.

  messageCreated(
    companyId: string,
    conversationId: string,
    message: { id: string; direction: string; type: string; createdAt: Date },
  ): void {
    // Sin el cuerpo del mensaje: el evento avisa de que hay algo nuevo y el
    // cliente lo recarga por la API, que ya aplica sus permisos. Enviar el
    // contenido por el canal duplicaría la superficie de exposición.
    this.toConversation(companyId, conversationId, EVENTS.MESSAGE_CREATED, {
      conversationId,
      messageId: message.id,
      direction: message.direction,
      type: message.type,
      createdAt: message.createdAt,
    });
    // La lista de conversaciones también necesita enterarse, y esa la ve toda
    // la empresa.
    this.toCompany(companyId, EVENTS.CONVERSATION_UPDATED, { conversationId });
  }

  messageStatusChanged(
    companyId: string,
    conversationId: string,
    messageId: string,
    status: string,
  ): void {
    this.toConversation(
      companyId,
      conversationId,
      EVENTS.MESSAGE_STATUS_CHANGED,
      { conversationId, messageId, status },
    );
  }

  /**
   * Una oportunidad cambió.
   *
   * Lleva `pipelineId` para que el cliente recargue SOLO el tablero afectado.
   * Sin él, mover una oportunidad obliga a recargar todos los embudos de la
   * empresa, y en una con cuatro tableros abiertos eso es tres consultas
   * tiradas por cada arrastre.
   *
   * Siguen viajando únicamente identificadores: el contenido se pide luego por
   * la API, que aplica los permisos de quien pregunta. Un evento con los datos
   * dentro podría enseñar algo que la API no habría devuelto.
   */
  leadUpdated(
    companyId: string,
    leadId: string,
    stageId?: string,
    pipelineId?: string,
  ): void {
    this.toCompany(companyId, EVENTS.LEAD_UPDATED, {
      leadId,
      stageId,
      pipelineId,
    });
  }

  taskUpdated(companyId: string, taskId: string, assignedTo?: string): void {
    this.toCompany(companyId, EVENTS.TASK_UPDATED, { taskId });
    if (assignedTo) {
      this.toUser(assignedTo, EVENTS.TASK_UPDATED, { taskId });
    }
  }

  notificationCreated(userId: string, notificationId: string): void {
    this.toUser(userId, EVENTS.NOTIFICATION_CREATED, { notificationId });
  }

  private emit(room: string, event: string, payload: unknown): void {
    try {
      // `server` puede no existir todavía durante el arranque, o nunca si el
      // puente de Redis del worker no llegó a abrirse. En ambos casos el
      // evento se pierde y el polling del frontend lo cubre.
      this.transport.server?.to(room).emit(event, payload);
    } catch (error) {
      this.logger.warn(
        `No se pudo emitir el evento en tiempo real [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
    }
  }
}
