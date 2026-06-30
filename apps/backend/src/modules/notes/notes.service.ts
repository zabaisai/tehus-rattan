import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async findByLead(leadId: string, companyId: string) {
    return this.prisma.note.findMany({
      where: { leadId, companyId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByConversation(conversationId: string, companyId: string) {
    return this.prisma.note.findMany({
      where: { conversationId, companyId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    companyId: string,
    userId: string,
    data: { content: string; leadId?: string; conversationId?: string },
  ) {
    return this.prisma.note.create({
      data: { ...data, companyId, createdBy: userId },
    });
  }

  async remove(id: string, companyId: string) {
    const note = await this.prisma.note.findFirst({ where: { id, companyId } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    return this.prisma.note.delete({ where: { id } });
  }
}
