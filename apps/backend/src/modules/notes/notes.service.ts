import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    await this.validateLead(data.leadId, companyId);
    await this.validateConversation(data.conversationId, companyId);

    return this.prisma.note.create({
      data: { ...data, companyId, createdBy: userId },
    });
  }

  async remove(id: string, companyId: string) {
    const note = await this.prisma.note.findFirst({ where: { id, companyId } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    return this.prisma.note.delete({ where: { id } });
  }

  private async validateLead(leadId: string | undefined, companyId: string) {
    if (leadId === undefined) return;

    if (!leadId.trim()) {
      throw new BadRequestException('leadId no puede estar vacio');
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true },
    });

    if (!lead) throw new NotFoundException('Lead no encontrado');
  }

  private async validateConversation(
    conversationId: string | undefined,
    companyId: string,
  ) {
    if (conversationId === undefined) return;

    if (!conversationId.trim()) {
      throw new BadRequestException('conversationId no puede estar vacio');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      select: { id: true },
    });

    if (!conversation)
      throw new NotFoundException('Conversacion no encontrada');
  }
}
