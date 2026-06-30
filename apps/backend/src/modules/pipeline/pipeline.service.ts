import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PipelineService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.pipeline.findMany({
      where: { companyId },
      include: {
        stages: { orderBy: { order: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string, companyId: string) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, companyId },
      include: {
        stages: { orderBy: { order: 'asc' } },
      },
    });
    if (!pipeline) throw new NotFoundException('Pipeline no encontrado');
    return pipeline;
  }

  async create(companyId: string, data: { name: string; isDefault?: boolean }) {
    return this.prisma.pipeline.create({
      data: { ...data, companyId },
    });
  }

  async update(
    id: string,
    companyId: string,
    data: { name?: string; isDefault?: boolean },
  ) {
    await this.findById(id, companyId);
    return this.prisma.pipeline.update({ where: { id }, data });
  }

  async remove(id: string, companyId: string) {
    await this.findById(id, companyId);

    const stageCount = await this.prisma.pipelineStage.count({
      where: { pipelineId: id },
    });
    if (stageCount > 0) {
      throw new BadRequestException(
        'No se puede eliminar un pipeline que tiene etapas. Elimina primero las etapas.',
      );
    }

    return this.prisma.pipeline.delete({ where: { id } });
  }

  // ───────────────────────────────────────────
  // ETAPAS
  // ───────────────────────────────────────────

  async findStages(pipelineId: string, companyId: string) {
    await this.findById(pipelineId, companyId);
    return this.prisma.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
    });
  }

  async createStage(
    pipelineId: string,
    companyId: string,
    data: { name: string; order?: number; color?: string },
  ) {
    await this.findById(pipelineId, companyId);

    let order = data.order;
    if (order === undefined) {
      const lastStage = await this.prisma.pipelineStage.findFirst({
        where: { pipelineId },
        orderBy: { order: 'desc' },
      });
      order = lastStage ? lastStage.order + 1 : 0;
    }

    return this.prisma.pipelineStage.create({
      data: { ...data, order, pipelineId },
    });
  }

  async updateStage(
    pipelineId: string,
    stageId: string,
    companyId: string,
    data: { name?: string; order?: number; color?: string },
  ) {
    await this.findById(pipelineId, companyId);

    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) throw new NotFoundException('Etapa no encontrada');

    return this.prisma.pipelineStage.update({
      where: { id: stageId },
      data,
    });
  }

  async removeStage(pipelineId: string, stageId: string, companyId: string) {
    await this.findById(pipelineId, companyId);

    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) throw new NotFoundException('Etapa no encontrada');

    const leadCount = await this.prisma.lead.count({
      where: { stageId },
    });
    if (leadCount > 0) {
      throw new BadRequestException(
        'No se puede eliminar una etapa que tiene leads activos. Mueve los leads primero.',
      );
    }

    return this.prisma.pipelineStage.delete({ where: { id: stageId } });
  }

  async reorderStages(
    pipelineId: string,
    companyId: string,
    stages: { id: string; order: number }[],
  ) {
    await this.findById(pipelineId, companyId);

    const stageIds = stages.map((s) => s.id);
    const existingStages = await this.prisma.pipelineStage.findMany({
      where: { id: { in: stageIds }, pipelineId },
    });

    if (existingStages.length !== stages.length) {
      throw new BadRequestException(
        'Una o más etapas no pertenecen a este pipeline',
      );
    }

    return this.prisma.$transaction(
      stages.map((s) =>
        this.prisma.pipelineStage.update({
          where: { id: s.id },
          data: { order: s.order },
        }),
      ),
    );
  }
  async getKanban(pipelineId: string, companyId: string) {
    const pipeline = await this.findById(pipelineId, companyId);

    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
      include: {
        leads: {
          where: { companyId, status: 'OPEN' },
          include: {
            contact: { select: { id: true, name: true, phone: true } },
            agent: { select: { id: true, name: true } },
          },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });

    const stagesWithTotals = stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      totalValue: stage.leads.reduce((sum, lead) => sum + (lead.value || 0), 0),
      leadCount: stage.leads.length,
      leads: stage.leads,
    }));

    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      stages: stagesWithTotals,
    };
  }
}
