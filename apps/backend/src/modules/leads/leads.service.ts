import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: {
      pipelineId?: string;
      stageId?: string;
      contactId?: string;
      assignedTo?: string;
      status?: string;
      search?: string;
      limit?: string;
      offset?: string;
    },
  ) {
    const pagination = this.parsePagination(filters.limit, filters.offset);

    return this.prisma.lead.findMany({
      where: {
        companyId,
        ...(filters.pipelineId && { pipelineId: filters.pipelineId }),
        ...(filters.stageId && { stageId: filters.stageId }),
        ...(filters.contactId && { contactId: filters.contactId }),
        ...(filters.assignedTo && { assignedTo: filters.assignedTo }),
        ...(filters.status && { status: filters.status as any }),
        ...(filters.search && {
          title: { contains: filters.search, mode: 'insensitive' },
        }),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        stage: { select: { id: true, name: true, color: true } },
        agent: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      ...pagination,
    });
  }

  async findById(id: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        stage: true,
        pipeline: true,
        agent: { select: { id: true, name: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  async create(
    companyId: string,
    userId: string,
    data: {
      title: string;
      contactId: string;
      pipelineId: string;
      stageId: string;
      value?: number;
      expectedCloseDate?: string;
      assignedTo?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: data.contactId, companyId },
      });
      if (!contact)
        throw new BadRequestException(
          'El contacto no pertenece a esta empresa',
        );

      const stage = await tx.pipelineStage.findFirst({
        where: { id: data.stageId, pipelineId: data.pipelineId },
      });
      if (!stage)
        throw new BadRequestException(
          'La etapa no pertenece al pipeline indicado',
        );

      const pipeline = await tx.pipeline.findFirst({
        where: { id: data.pipelineId, companyId },
      });
      if (!pipeline)
        throw new BadRequestException(
          'El pipeline no pertenece a esta empresa',
        );

      await this.validateAssignedUser(data.assignedTo, companyId, tx);

      const lead = await tx.lead.create({
        data: {
          ...data,
          companyId,
          expectedCloseDate: data.expectedCloseDate
            ? new Date(data.expectedCloseDate)
            : undefined,
        },
      });

      // Every lead needs a stage history trail from the moment it exists —
      // even one created directly into a non-first stage — so changeStage's
      // later entries always have a starting point to read "from". Same
      // transaction as the lead itself: either both are written, or neither is.
      await tx.leadStageHistory.create({
        data: {
          leadId: lead.id,
          fromStageId: null,
          toStageId: lead.stageId,
          changedBy: userId,
        },
      });

      return tx.lead.findUniqueOrThrow({
        where: { id: lead.id },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          stage: { select: { id: true, name: true, color: true } },
          agent: { select: { id: true, name: true } },
        },
      });
    });
  }

  async update(
    id: string,
    companyId: string,
    data: {
      title?: string;
      value?: number;
      expectedCloseDate?: string;
      assignedTo?: string;
    },
  ) {
    await this.findById(id, companyId);
    await this.validateAssignedUser(data.assignedTo, companyId);

    return this.prisma.lead.update({
      where: { id },
      data: {
        ...data,
        expectedCloseDate: data.expectedCloseDate
          ? new Date(data.expectedCloseDate)
          : undefined,
      },
    });
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);
    return this.prisma.lead.delete({ where: { id } });
  }

  async changeStage(
    id: string,
    companyId: string,
    stageId: string,
    userId: string,
  ) {
    const lead = await this.findById(id, companyId);

    const newStage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId: lead.pipelineId },
    });
    if (!newStage) {
      throw new BadRequestException(
        'La etapa destino no pertenece al pipeline de este lead',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: { stageId },
      });

      await tx.leadStageHistory.create({
        data: {
          leadId: id,
          fromStageId: lead.stageId,
          toStageId: stageId,
          changedBy: userId,
        },
      });

      return updated;
    });
  }

  async changeStatus(
    id: string,
    companyId: string,
    status: 'WON' | 'LOST',
    lostReason?: string,
  ) {
    await this.findById(id, companyId);
    return this.prisma.lead.update({
      where: { id },
      data: {
        status,
        lostReason: status === 'LOST' ? lostReason : null,
      },
    });
  }

  async getHistory(id: string, companyId: string) {
    await this.findById(id, companyId);
    // Ascending so the initial null -> firstStage record (now always
    // present, see create()) reads first, followed by each later
    // changeStage transition in the order they actually happened.
    return this.prisma.leadStageHistory.findMany({
      where: { leadId: id },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { changedAt: 'asc' },
    });
  }

  private async validateAssignedUser(
    assignedTo: string | undefined,
    companyId: string,
    // Accepts the transaction client so callers running inside
    // this.prisma.$transaction (e.g. create) read/validate against the same
    // transaction instead of a separate connection.
    client: Pick<PrismaService, 'user'> = this.prisma,
  ) {
    if (assignedTo === undefined) return;

    if (!assignedTo.trim()) {
      throw new BadRequestException('assignedTo no puede estar vacio');
    }

    const user = await client.user.findFirst({
      where: { id: assignedTo, companyId, isActive: true },
      select: { id: true },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
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
