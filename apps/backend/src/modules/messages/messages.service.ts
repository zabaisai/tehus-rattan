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
        throw new NotFoundException('ConversaciÃ³n no encontrada');

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
}
