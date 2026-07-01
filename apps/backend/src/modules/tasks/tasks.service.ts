import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    await this.validateAssignedUser(data.assignedTo, companyId);
    await this.validateLead(data.leadId, companyId);
    await this.validateContact(data.contactId, companyId);

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
    await this.validateAssignedUser(data.assignedTo, companyId);

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

  private async validateAssignedUser(assignedTo: string | undefined, companyId: string) {
    if (assignedTo === undefined) return;

    if (!assignedTo.trim()) {
      throw new BadRequestException('assignedTo no puede estar vacio');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: assignedTo, companyId, isActive: true },
      select: { id: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
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

  private async validateContact(contactId: string | undefined, companyId: string) {
    if (contactId === undefined) return;

    if (!contactId.trim()) {
      throw new BadRequestException('contactId no puede estar vacio');
    }

    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, companyId },
      select: { id: true },
    });

    if (!contact) throw new NotFoundException('Contacto no encontrado');
  }
}
