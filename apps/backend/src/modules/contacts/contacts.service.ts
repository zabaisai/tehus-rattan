import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: { search?: string; limit?: string; offset?: string } = {},
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);

    return this.prisma.contact.findMany({
      where: {
        companyId,
        ...(filters.search && {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      ...pagination,
    });
  }

  async findById(id: string, companyId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, companyId },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return contact;
  }

  async create(
    companyId: string,
    data: {
      phone: string;
      name?: string;
      email?: string;
      tags?: string[];
    },
  ) {
    return this.prisma.contact.create({
      data: { ...data, companyId },
    });
  }

  async update(
    id: string,
    companyId: string,
    data: {
      name?: string;
      email?: string;
      tags?: string[];
    },
  ) {
    await this.findById(id, companyId);
    return this.prisma.contact.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.contact.delete({ where: { id } });
  }

  async block(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.contact.update({
      where: { id },
      data: { isBlocked: true },
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
