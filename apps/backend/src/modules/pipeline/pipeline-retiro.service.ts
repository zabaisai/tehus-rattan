import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lo que hay dentro de un embudo antes de retirarlo.
 *
 * Un embudo con oportunidades no se puede borrar y tampoco se puede archivar a
 * la ligera: las oportunidades siguen ahi, pero dejan de verse, y lo que un
 * asesor concluye es que el CRM le perdio la venta. Asi que primero se enseña
 * cuantas hay y donde estan, y solo despues se ofrece que hacer con ellas.
 */
export interface ResumenDeRetiro {
  pipelineId: string;
  nombre: string;
  archivado: boolean;
  esPredeterminado: boolean;
  /** Cuantas oportunidades hay, por estado. */
  oportunidades: {
    abiertas: number;
    ganadas: number;
    perdidas: number;
    total: number;
  };
  /** Reparto por etapa, para que se vea de donde saldrian. */
  porEtapa: Array<{ stageId: string; nombre: string; total: number }>;
  /** Si es la referencia de la configuracion de leads de la empresa. */
  enUsoPorLaConfiguracion: boolean;
  /**
   * Que se puede hacer HOY con este embudo. La interfaz pinta los botones a
   * partir de esto en vez de deducirlo por su cuenta y equivocarse.
   */
  puede: {
    eliminar: boolean;
    archivar: boolean;
    requiereTraslado: boolean;
  };
  motivo: string | null;
}

@Injectable()
export class PipelineRetiroService {
  constructor(private prisma: PrismaService) {}

  async resumen(id: string, companyId: string): Promise<ResumenDeRetiro> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, isArchived: true, isDefault: true },
    });
    if (!pipeline) throw new NotFoundException('Pipeline no encontrado');

    const etapas = await this.prisma.pipelineStage.findMany({
      where: { pipelineId: id },
      select: { id: true, name: true, order: true },
      orderBy: { order: 'asc' },
    });

    const [abiertas, ganadas, perdidas, porEtapaCrudo, enConfiguracion] =
      await Promise.all([
        this.prisma.lead.count({
          where: { pipelineId: id, companyId, status: 'OPEN' },
        }),
        this.prisma.lead.count({
          where: { pipelineId: id, companyId, status: 'WON' },
        }),
        this.prisma.lead.count({
          where: { pipelineId: id, companyId, status: 'LOST' },
        }),
        this.prisma.lead.groupBy({
          by: ['stageId'],
          where: { pipelineId: id, companyId },
          _count: { _all: true },
        }),
        this.prisma.companyLeadSettings.count({
          where: { companyId, defaultPipelineId: id },
        }),
      ]);

    const conteoPorEtapa = new Map(
      porEtapaCrudo.map((f) => [f.stageId, f._count._all]),
    );

    const total = abiertas + ganadas + perdidas;
    const esPredeterminado = pipeline.isDefault;
    const enUsoPorLaConfiguracion = enConfiguracion > 0;

    let motivo: string | null = null;
    if (esPredeterminado) {
      motivo =
        'Es el embudo predeterminado de la empresa. Marca otro como predeterminado antes de retirarlo.';
    } else if (total > 0) {
      motivo = `Tiene ${total} ${total === 1 ? 'oportunidad' : 'oportunidades'}. Trasládalas a otro embudo antes de eliminarlo, o archívalo para conservarlas donde están.`;
    } else if (enUsoPorLaConfiguracion) {
      motivo =
        'La configuración de oportunidades de la empresa apunta a este embudo. Cámbiala antes de eliminarlo.';
    }

    return {
      pipelineId: pipeline.id,
      nombre: pipeline.name,
      archivado: pipeline.isArchived,
      esPredeterminado,
      oportunidades: { abiertas, ganadas, perdidas, total },
      porEtapa: etapas.map((e) => ({
        stageId: e.id,
        nombre: e.name,
        total: conteoPorEtapa.get(e.id) ?? 0,
      })),
      enUsoPorLaConfiguracion,
      puede: {
        eliminar: !esPredeterminado && total === 0 && !enUsoPorLaConfiguracion,
        archivar: !esPredeterminado && !pipeline.isArchived,
        requiereTraslado: total > 0,
      },
      motivo,
    };
  }

  /**
   * Traslada TODAS las oportunidades de un embudo a una etapa de otro.
   *
   * Va en una sola transaccion y con los dos extremos verificados dentro de
   * ella: si el embudo de destino se archiva o la etapa se borra a mitad, la
   * operacion entera se deshace en vez de dejar la mitad de las oportunidades
   * apuntando a una etapa que ya no existe.
   *
   * Nunca borra una oportunidad. Mover es mover.
   */
  async trasladarOportunidades(
    origenId: string,
    companyId: string,
    destino: { pipelineId: string; stageId: string },
  ): Promise<{
    trasladadas: number;
    destino: { pipeline: string; etapa: string };
  }> {
    if (destino.pipelineId === origenId) {
      throw new BadRequestException(
        'El embudo de destino tiene que ser distinto del de origen.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const origen = await tx.pipeline.findFirst({
        where: { id: origenId, companyId },
        select: { id: true, name: true },
      });
      if (!origen)
        throw new NotFoundException('Pipeline de origen no encontrado');

      // El destino se busca acotado por companyId: sin eso, un id de otra
      // empresa moveria oportunidades fuera de su casa.
      const pipelineDestino = await tx.pipeline.findFirst({
        where: { id: destino.pipelineId, companyId },
        select: { id: true, name: true, isArchived: true },
      });
      if (!pipelineDestino) {
        throw new NotFoundException('Pipeline de destino no encontrado');
      }
      if (pipelineDestino.isArchived) {
        throw new BadRequestException(
          'El embudo de destino está archivado. Restáuralo antes de mover oportunidades a él.',
        );
      }

      const etapaDestino = await tx.pipelineStage.findFirst({
        where: { id: destino.stageId, pipelineId: destino.pipelineId },
        select: { id: true, name: true },
      });
      if (!etapaDestino) {
        throw new NotFoundException(
          'La etapa de destino no existe o no pertenece al embudo de destino.',
        );
      }

      const movidas = await tx.lead.updateMany({
        where: { pipelineId: origenId, companyId },
        data: { pipelineId: destino.pipelineId, stageId: destino.stageId },
      });

      return {
        trasladadas: movidas.count,
        destino: { pipeline: pipelineDestino.name, etapa: etapaDestino.name },
      };
    });
  }

  /**
   * Archivar es retirar de la operacion conservandolo todo. Se comprueba
   * dentro de la transaccion que sigue sin ser el predeterminado: entre la
   * lectura y la escritura alguien pudo marcarlo, y una empresa sin embudo
   * predeterminado no sabe donde poner el siguiente lead.
   */
  async archivar(
    id: string,
    companyId: string,
  ): Promise<{ archivado: boolean; oportunidades: number }> {
    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.pipeline.findFirst({
        where: { id, companyId },
        select: { id: true, isDefault: true, isArchived: true },
      });
      if (!actual) throw new NotFoundException('Pipeline no encontrado');
      if (actual.isDefault) {
        throw new BadRequestException(
          'No se puede archivar el embudo predeterminado. Marca otro como predeterminado primero.',
        );
      }
      if (actual.isArchived) {
        return { archivado: false, oportunidades: 0 };
      }

      const oportunidades = await tx.lead.count({
        where: { pipelineId: id, companyId },
      });

      const cambiados = await tx.pipeline.updateMany({
        where: { id, companyId, isDefault: false, isArchived: false },
        data: { isArchived: true },
      });
      if (cambiados.count === 0) {
        throw new ConflictException(
          'El embudo cambió mientras se archivaba. Vuelve a intentarlo.',
        );
      }

      return { archivado: true, oportunidades };
    });
  }

  async restaurar(
    id: string,
    companyId: string,
  ): Promise<{ restaurado: boolean }> {
    const actual = await this.prisma.pipeline.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!actual) throw new NotFoundException('Pipeline no encontrado');

    const cambiados = await this.prisma.pipeline.updateMany({
      where: { id, companyId, isArchived: true },
      data: { isArchived: false },
    });
    return { restaurado: cambiados.count > 0 };
  }

  /**
   * Reordena los embudos de la empresa.
   *
   * Todos los ids se comprueban contra `companyId` ANTES de escribir nada: un
   * id ajeno colado en la lista reordenaria el embudo de otra empresa.
   */
  async reordenar(
    companyId: string,
    orden: Array<{ id: string; order: number }>,
  ): Promise<{ reordenados: number }> {
    if (orden.length === 0) return { reordenados: 0 };

    const ids = orden.map((o) => o.id);
    const propios = await this.prisma.pipeline.count({
      where: { id: { in: ids }, companyId },
    });
    if (propios !== new Set(ids).size) {
      throw new BadRequestException(
        'Uno o más embudos no pertenecen a esta empresa.',
      );
    }

    await this.prisma.$transaction(
      orden.map((o) =>
        this.prisma.pipeline.updateMany({
          where: { id: o.id, companyId },
          data: { order: o.order },
        }),
      ),
    );

    return { reordenados: orden.length };
  }
}
