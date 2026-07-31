import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEmitter } from '../../common/realtime/realtime.emitter';

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeEmitter,
  ) {}

  async findAll(
    companyId: string,
    filters: {
      leadId?: string;
      contactId?: string;
      conversationId?: string;
      status?: string;
      assignedTo?: string;
      overdue?: boolean;
      search?: string;
      limit?: string;
      offset?: string;
    },
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);
    const where: any = {
      companyId,
      ...(filters.leadId && { leadId: filters.leadId }),
      ...(filters.contactId && { contactId: filters.contactId }),
      ...(filters.conversationId && {
        conversationId: filters.conversationId,
      }),
      ...(filters.status && { status: filters.status }),
      ...(filters.assignedTo && { assignedTo: filters.assignedTo }),
      ...(filters.search && {
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
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
        conversation: { select: { id: true, status: true, channel: true } },
        agent: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
      ...pagination,
    });
  }

  async findById(id: string, companyId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, companyId },
      include: {
        lead: { select: { id: true, title: true } },
        contact: { select: { id: true, name: true } },
        conversation: { select: { id: true, status: true, channel: true } },
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
      conversationId?: string;
      assignedTo?: string;
    },
  ) {
    await this.validateAssignedUser(data.assignedTo, companyId);
    await this.validateLead(data.leadId, companyId);
    await this.validateContact(data.contactId, companyId);
    await this.validateConversation(data.conversationId, companyId);

    const creada = await this.prisma.task.create({
      data: {
        ...data,
        companyId,
        priority: data.priority as any,
        type: data.type as any,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
    });

    // Al responsable le llega ademas por su sala personal: una tarea nueva
    // asignada es justo lo que no puede esperar al siguiente refresco.
    this.realtime.taskUpdated(
      companyId,
      creada.id,
      creada.assignedTo ?? undefined,
    );
    return creada;
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

    const actualizada = await this.prisma.task.update({
      where: { id },
      data: {
        ...data,
        priority: data.priority as any,
        status: data.status as any,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
    });

    this.realtime.taskUpdated(
      companyId,
      actualizada.id,
      actualizada.assignedTo ?? undefined,
    );
    return actualizada;
  }

  async complete(id: string, companyId: string) {
    await this.findById(id, companyId);
    const completada = await this.prisma.task.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    this.realtime.taskUpdated(
      companyId,
      completada.id,
      completada.assignedTo ?? undefined,
    );
    return completada;
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.task.delete({ where: { id } });
  }

  private async validateAssignedUser(
    assignedTo: string | undefined,
    companyId: string,
  ) {
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

  private async validateContact(
    contactId: string | undefined,
    companyId: string,
  ) {
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

  // Mismo patron que validateLead/validateContact: la conversacion debe
  // pertenecer a la MISMA empresa antes de escribir nada, de modo que un id
  // de otro tenant nunca llegue a la fila.
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
      throw new NotFoundException('Conversación no encontrada');
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
        throw new BadRequestException(
          'offset debe ser un entero mayor o igual a 0',
        );
      }
      pagination.skip = skip;
    }

    return pagination;
  }
}
