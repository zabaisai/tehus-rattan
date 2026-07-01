import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

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
        throw new BadRequestException('offset debe ser un entero mayor o igual a 0');
      }
      pagination.skip = skip;
    }

    return pagination;
  }
}
