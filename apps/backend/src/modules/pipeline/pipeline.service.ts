import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { suma, aNumeroParaMostrar } from '../../common/dinero/dinero';

@Injectable()
export class PipelineService {
  constructor(private prisma: PrismaService) {}

  // Por defecto oculta los archivados: son pipelines retirados de la
  // operación, no borrados. `includeArchived` los recupera para la pantalla
  // de administración.
  async findAll(companyId: string, includeArchived = false) {
    return this.prisma.pipeline.findMany({
      where: { companyId, ...(includeArchived ? {} : { isArchived: false }) },
      include: {
        stages: { orderBy: { order: 'asc' } },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
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

  async create(
    companyId: string,
    data: { name: string; isDefault?: boolean; order?: number },
  ) {
    // Marcar predeterminado desmarca el anterior EN LA MISMA TRANSACCIÓN. El
    // índice parcial `pipelines_one_default_per_company` lo garantiza a nivel
    // de base; hacerlo aquí evita que el usuario vea un error de constraint
    // por una operación que sí es legítima.
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.pipeline.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.create({ data: { ...data, companyId } });
    });
  }

  async update(
    id: string,
    companyId: string,
    data: {
      name?: string;
      isDefault?: boolean;
      order?: number;
      isArchived?: boolean;
    },
  ) {
    const actual = await this.findById(id, companyId);

    // Una empresa no puede quedarse sin predeterminado: ni desmarcándolo ni
    // archivándolo. Sin él, la creación automática de oportunidades no tiene
    // dónde colocar el lead.
    if (actual.isDefault && (data.isDefault === false || data.isArchived)) {
      throw new BadRequestException(
        'No se puede desmarcar ni archivar el pipeline predeterminado. Marca otro como predeterminado primero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.pipeline.updateMany({
          where: { companyId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.update({ where: { id }, data });
    });
  }

  /**
   * Elimina un embudo VACIO. Todo lo demas se bloquea con el motivo concreto.
   *
   * Antes solo miraba las etapas y decia «elimina primero las etapas», que es
   * verdad pero no es la razon: lo que impide borrar un embudo en uso son las
   * OPORTUNIDADES que tiene dentro, y ese mensaje mandaba a borrar etapas una
   * a una hasta chocar con la que si las tenia. Ahora se dice lo que pasa y
   * hacia donde ir.
   *
   * Va todo en una transaccion: si entra una oportunidad entre el conteo y el
   * borrado, se deshace en vez de dejarla apuntando a un embudo inexistente.
   */
  async remove(id: string, companyId: string) {
    const actual = await this.findById(id, companyId);

    if (actual.isDefault) {
      throw new BadRequestException(
        'No se puede eliminar el pipeline predeterminado. Marca otro como predeterminado primero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const leadCount = await tx.lead.count({
        where: { pipelineId: id, companyId },
      });
      if (leadCount > 0) {
        throw new BadRequestException(
          `No se puede eliminar un embudo con ${leadCount} ${
            leadCount === 1 ? 'oportunidad' : 'oportunidades'
          }. Trasládalas a otro embudo primero, o archiva este para conservarlas donde están.`,
        );
      }

      const enConfiguracion = await tx.companyLeadSettings.count({
        where: { companyId, defaultPipelineId: id },
      });
      if (enConfiguracion > 0) {
        throw new BadRequestException(
          'La configuración de oportunidades de la empresa apunta a este embudo. Cámbiala antes de eliminarlo.',
        );
      }

      // Las etapas de un embudo sin oportunidades no son datos del negocio:
      // son la forma del embudo que se esta retirando, y obligar a borrarlas
      // de una en una no protege nada.
      await tx.pipelineStage.deleteMany({ where: { pipelineId: id } });

      const borrados = await tx.pipeline.deleteMany({
        where: { id, companyId, isDefault: false },
      });
      if (borrados.count === 0) {
        throw new ConflictException(
          'El embudo cambió mientras se eliminaba. Vuelve a intentarlo.',
        );
      }

      return { id, eliminado: true };
    });
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
    data: {
      name: string;
      order?: number;
      color?: string;
      probability?: number;
      type?: 'OPEN' | 'WON' | 'LOST';
      isInitial?: boolean;
    },
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

    // Una etapa inicial y solo una por embudo. Si la nueva lo es, la anterior
    // deja de serlo en la MISMA transacción: con dos marcadas, cuál recibe al
    // cliente que acaba de escribir depende del orden de la consulta, y eso no
    // se puede depurar mirando la pantalla.
    if (data.isInitial) {
      return this.prisma.$transaction(async (tx) => {
        await tx.pipelineStage.updateMany({
          where: { pipelineId, isInitial: true },
          data: { isInitial: false },
        });
        return tx.pipelineStage.create({
          data: { ...data, order, pipelineId },
        });
      });
    }

    return this.prisma.pipelineStage.create({
      data: { ...data, order, pipelineId },
    });
  }

  async updateStage(
    pipelineId: string,
    stageId: string,
    companyId: string,
    data: {
      name?: string;
      order?: number;
      color?: string;
      probability?: number;
      type?: 'OPEN' | 'WON' | 'LOST';
      isInitial?: boolean;
    },
  ) {
    await this.findById(pipelineId, companyId);

    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) throw new NotFoundException('Etapa no encontrada');

    // Quitar la marca a mano dejaría el embudo SIN etapa inicial, y entonces
    // el primer mensaje de un cliente cae en «la primera por orden», que es
    // una regla de reserva y no una decisión de nadie. Se cambia de etapa
    // inicial marcando otra, no desmarcando esta.
    if (data.isInitial === false && stage.isInitial) {
      throw new BadRequestException(
        'Un embudo necesita una etapa de entrada. Marca otra como inicial en vez de quitarle la marca a esta.',
      );
    }

    if (data.isInitial) {
      return this.prisma.$transaction(async (tx) => {
        await tx.pipelineStage.updateMany({
          where: { pipelineId, isInitial: true, id: { not: stageId } },
          data: { isInitial: false },
        });
        return tx.pipelineStage.update({ where: { id: stageId }, data });
      });
    }

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

    // Borrar la etapa de entrada deja el embudo sin puerta: el siguiente
    // mensaje caería en «la primera por orden», que puede ser «Ganado».
    if (stage.isInitial) {
      const otras = await this.prisma.pipelineStage.count({
        where: { pipelineId, id: { not: stageId } },
      });
      if (otras > 0) {
        throw new BadRequestException(
          'Esa es la etapa de entrada del embudo. Marca otra como inicial antes de borrarla.',
        );
      }
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
      totalValue: aNumeroParaMostrar(suma(...stage.leads.map((l) => l.value))),
      leadCount: stage.leads.length,
      leads: stage.leads,
    }));

    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      stages: stagesWithTotals,
    };
  }
}
