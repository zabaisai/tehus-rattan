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
    status?: string;
  }) {
    return this.prisma.message.create({ data });
  }

  async findByWamid(wamid: string) {
    return this.prisma.message.findUnique({ where: { wamid } });
  }
}
