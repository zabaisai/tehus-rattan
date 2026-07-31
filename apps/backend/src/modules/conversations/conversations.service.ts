import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeEmitter } from '../../common/realtime/realtime.emitter';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private realtime: RealtimeEmitter,
  ) {}

  async findAll(
    companyId: string,
    filters: { search?: string; limit?: string; offset?: string } = {},
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);

    return this.prisma.conversation.findMany({
      where: {
        companyId,
        ...(filters.search && {
          contact: {
            is: {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { phone: { contains: filters.search, mode: 'insensitive' } },
              ],
            },
          },
        }),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        agent: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        // La oportunidad ligada. Se incluye en la lista y en el detalle para
        // que el asesor vea desde el chat en que punto del embudo esta ese
        // cliente, sin tener que buscarlo en el tablero. Nullable siempre: no
        // toda conversacion es una venta.
        lead: {
          select: {
            id: true,
            title: true,
            status: true,
            stage: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...pagination,
    });
  }

  async findById(id: string, companyId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        agent: { select: { id: true, name: true } },
        // La oportunidad ligada. Se incluye en la lista y en el detalle para
        // que el asesor vea desde el chat en que punto del embudo esta ese
        // cliente, sin tener que buscarlo en el tablero. Nullable siempre: no
        // toda conversacion es una venta.
        lead: {
          select: {
            id: true,
            title: true,
            status: true,
            stage: { select: { id: true, name: true, color: true } },
          },
        },
        // El numero por el que entro, para poder responder desde el mismo y
        // para que la interfaz pueda decir cual es. Nunca el token.
        whatsappIntegration: {
          select: {
            id: true,
            phoneNumberId: true,
            displayPhoneNumber: true,
            label: true,
            status: true,
          },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    return conv;
  }

  async update(id: string, companyId: string, data: any) {
    await this.findById(id, companyId);

    if (data.assignedTo !== undefined) {
      if (!data.assignedTo.trim()) {
        throw new BadRequestException('assignedTo no puede estar vacio');
      }

      const user = await this.prisma.user.findFirst({
        where: { id: data.assignedTo, companyId, isActive: true },
        select: { id: true },
      });

      if (!user) throw new NotFoundException('Usuario no encontrado');
    }

    const actualizada = await this.prisma.conversation.update({
      where: { id },
      data,
    });

    // Reasignar a mano era silencioso: el nuevo responsable no se enteraba
    // hasta que abria la bandeja por su cuenta, y mientras tanto el cliente
    // esperaba. El reparto automatico si avisa; esto lo iguala.
    if (data.assignedTo) {
      await this.notifications.emit({
        companyId,
        recipientUserId: data.assignedTo,
        type: 'CONVERSATION_ASSIGNED',
        title: 'Te asignaron una conversacion',
        entityType: 'Conversation',
        entityId: id,
        actionUrl: '/dashboard/conversations',
        // Sin cubo temporal: cada reasignacion es un hecho distinto que su
        // destinatario debe ver, aunque la conversacion vaya y venga.
        dedupeKey: `CONVERSATION_ASSIGNED:${id}:${data.assignedTo}`,
      });
    }

    this.realtime.toCompany(companyId, 'v1:conversation.updated', {
      conversationId: id,
    });

    return actualizada;
  }

  async pause(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.conversation.update({
      where: { id },
      data: { isPaused: true },
    });
  }

  async resume(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.conversation.update({
      where: { id },
      data: { isPaused: false },
    });
  }

  /**
   * `whatsappIntegrationId` es el número por el que ENTRÓ el mensaje.
   *
   * En una conversación que ya existe se rellena solo si estaba vacío: si el
   * cliente escribió antes a otro número de la misma empresa, el hilo sigue
   * perteneciendo a aquel, y cambiarlo a mitad haría que las respuestas
   * empezaran a salir desde un número distinto del que el cliente conoce.
   */
  async findOrCreate(
    companyId: string,
    contactId: string,
    whatsappIntegrationId?: string,
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: { companyId, contactId, status: 'OPEN' },
    });

    if (existing) {
      if (whatsappIntegrationId && !existing.whatsappIntegrationId) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { whatsappIntegrationId },
        });
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: { companyId, contactId, whatsappIntegrationId },
    });
  }

  private parsePagination(limit?: string, offset?: string) {
    const pagination: { take?: number; skip?: number } = {};

    if (limit !== undefined) {
      const take = Number(limit);
      if (!Number.isInteger(take) || take < 1 || take > 100) {
        throw new BadRequestException('limit debe ser un entero entre 1 y 100');
      }
      pagination.take = take;
    }

    if (offset !== undefined) {
      const skip = Number(offset);
      if (!Number.isInteger(skip) || skip < 0) {
        throw new BadRequestException(
          'offset debe ser un entero mayor o igual a 0',
        );
      }
      pagination.skip = skip;
    }

    return pagination;
  }
}
