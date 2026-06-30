import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: {
      leadId?: string;
      contactId?: string;
      status?: string;
      assignedTo?: string;
      overdue?: boolean;
    },
  ) {
    const where: any = {
      companyId,
      ...(filters.leadId && { leadId: filters.leadId }),
      ...(filters.contactId && { contactId: filters.contactId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.assignedTo && { assignedTo: filters.assignedTo }),
    };

    if (filters.overdue) {
      where.dueDate = { lt: new Date() };
      where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
    }

    return this.prisma.task.findMany({
      where,
      include: {
        lead: { select: { id: true, title: true } },
        contact: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async findById(id: string, companyId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, companyId },
      include: {
        lead: { select: { id: true, title: true } },
        contact: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });
    if (!task) throw new NotFoundException('Tarea no encontrada');
    return task;
  }

  async create(
    companyId: string,
    data: {
      title: string;
      description?: string;
      dueDate?: string;
      priority?: string;
      type?: string;
      leadId?: string;
      contactId?: string;
      assignedTo?: string;
    },
  ) {
    return this.prisma.task.create({
      data: {
        ...data,
        companyId,
        priority: data.priority as any,
        type: data.type as any,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
    });
  }

  async update(
    id: string,
    companyId: string,
    data: {
      title?: string;
      description?: string;
      dueDate?: string;
      priority?: string;
      status?: string;
      assignedTo?: string;
    },
  ) {
    await this.findById(id, companyId);
    return this.prisma.task.update({
      where: { id },
      data: {
        ...data,
        priority: data.priority as any,
        status: data.status as any,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
    });
  }

  async complete(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.task.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.task.delete({ where: { id } });
  }
}
