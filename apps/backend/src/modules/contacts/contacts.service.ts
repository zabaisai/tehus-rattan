import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.contact.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
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
}
