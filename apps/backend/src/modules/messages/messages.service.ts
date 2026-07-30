import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  async findByConversation(conversationId: string, companyId: string) {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        conversation: { companyId },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(data: {
    companyId: string;
    conversationId: string;
    body: string;
    direction: any;
    type?: any;
    wamid?: string;
    // Medios y metadatos entregados por Meta. Todos opcionales: un mensaje de
    // texto no los lleva y no deben escribirse como null explicito.
    mediaId?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaFileName?: string;
    mediaSize?: number;
    mediaDuration?: number;
    caption?: string;
    location?: any;
    contacts?: any;
    interactive?: any;
    replyToWamid?: string;
    status?:
      | 'QUEUED'
      | 'SENDING'
      | 'SENT'
      | 'DELIVERED'
      | 'READ'
      | 'FAILED'
      | 'RECEIVED';
  }) {
    return this.prisma.$transaction(async (tx) => {
      const { companyId, ...messageData } = data;
      const conversation = await tx.conversation.findFirst({
        where: { id: data.conversationId, companyId },
        select: { id: true },
      });

      if (!conversation)
        throw new NotFoundException('Conversacion no encontrada');

      const message = await tx.message.create({ data: messageData });
      await tx.conversation.update({
        where: { id: messageData.conversationId },
        data: { lastMessageAt: new Date() },
      });
      return message;
    });
  }

  async findByWamid(wamid: string) {
    return this.prisma.message.findUnique({ where: { wamid } });
  }

  // Avance del ciclo de entrega notificado por Meta (payloads `statuses`).
  //
  // Nunca retrocede: Meta puede entregar `sent` después de `read` por
  // reordenamiento de red, y mostrar "enviado" sobre un mensaje ya leído sería
  // una regresión visible para el asesor. El orden es
  // SENT < DELIVERED < READ, con FAILED como estado terminal aparte.
  //
  // Idempotente: reprocesar el mismo estado no cambia nada, así que los
  // reintentos de Meta son inofensivos.
  async applyDeliveryStatus(input: {
    wamid: string;
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
    occurredAt?: Date;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<'updated' | 'ignored' | 'unknown'> {
    const existing = await this.prisma.message.findUnique({
      where: { wamid: input.wamid },
      select: { id: true, status: true },
    });

    if (!existing) return 'unknown';

    const rank: Record<string, number> = {
      QUEUED: 0,
      SENDING: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
    };

    const esRetroceso =
      input.status !== 'FAILED' &&
      (rank[existing.status] ?? 0) >= (rank[input.status] ?? 0);

    // Un mensaje ya fallido no se "recupera" con un estado anterior.
    if (existing.status === 'FAILED' && input.status !== 'FAILED') {
      return 'ignored';
    }
    if (esRetroceso) return 'ignored';

    const at = input.occurredAt ?? new Date();
    const marcas: Record<string, Record<string, Date>> = {
      SENT: { sentAt: at },
      DELIVERED: { deliveredAt: at },
      READ: { readAt: at },
      FAILED: { failedAt: at },
    };

    await this.prisma.message.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        ...marcas[input.status],
        ...(input.status === 'FAILED'
          ? {
              errorCode: input.errorCode ?? null,
              errorMessage: input.errorMessage ?? null,
            }
          : {}),
      },
    });

    return 'updated';
  }
}
