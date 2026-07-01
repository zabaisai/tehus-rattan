import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.conversation.findMany({
      where: { companyId },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        agent: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string, companyId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        agent: { select: { id: true, name: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }

  async update(id: string, companyId: string, data: any) {
    await this.findById(id, companyId);

    if (data.assignedTo !== undefined) {
      if (!data.assignedTo.trim()) {
        throw new BadRequestException('assignedTo no puede estar vacÃ­o');
      }

      const user = await this.prisma.user.findFirst({
        where: { id: data.assignedTo, companyId, isActive: true },
        select: { id: true },
      });

      if (!user) throw new NotFoundException('Usuario no encontrado');
    }

    return this.prisma.conversation.update({
      where: { id },
      data,
    });
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

  async findOrCreate(companyId: string, contactId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { companyId, contactId, status: 'OPEN' },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: { companyId, contactId },
    });
  }
}
