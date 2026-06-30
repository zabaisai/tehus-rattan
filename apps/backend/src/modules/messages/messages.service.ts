import { Injectable } from '@nestjs/common';
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
      const message = await tx.message.create({ data });
      await tx.conversation.update({
        where: { id: data.conversationId },
        data: { lastMessageAt: new Date() },
      });
      return message;
    });
  }

  async findByWamid(wamid: string) {
    return this.prisma.message.findUnique({ where: { wamid } });
  }
}
