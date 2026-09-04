import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, type PipelineStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { suma, aNumeroParaMostrar } from '../../common/dinero/dinero';
import { PIPELINE_LIMITS, STAGE_LIMITS } from '../companies/company-settings';

type StageType = 'OPEN' | 'WON' | 'LOST';
type Tx = Prisma.TransactionClient;

const TIPO_EN_ESPANOL: Record<StageType, string> = {
  OPEN: 'abierta',
  WON: 'ganada',
  LOST: 'perdida',
};

/** Nombres comparables: sin espacios repetidos ni distinción de mayúsculas. */
function claveDeNombre(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
}

/**
 * Normaliza un nombre escrito por una persona: recorta, colapsa espacios y
 * aplica el límite. Vacío o demasiado largo → 400 con el motivo.
 */
function normalizarNombre(
  value: string,
  maxLength: number,
  etiqueta: string,
): string {
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) {
    throw new BadRequestException(`El nombre ${etiqueta} es requerido`);
  }
  if (name.length > maxLength) {
    throw new BadRequestException(
      `El nombre ${etiqueta} debe tener como máximo ${maxLength} caracteres`,
    );
  }
  return name;
}

/** El índice parcial `pipelines_one_default_per_company` chocó en una carrera. */
function esConflictoDeDefault(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

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

  /**
   * Dos embudos de la misma empresa no pueden llamarse igual (sin distinguir
   * mayúsculas): el selector y el traslado de oportunidades se vuelven
   * ambiguos. Los archivados también cuentan: al restaurarlos volverían a
   * chocar.
   */
  private async asegurarNombreDePipelineLibre(
    reader: Tx | PrismaService,
    companyId: string,
    name: string,
    exceptoId?: string,
  ): Promise<void> {
    const otros = await reader.pipeline.findMany({
      where: { companyId, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
      select: { name: true },
    });
    const clave = claveDeNombre(name);
    if (otros.some((p) => claveDeNombre(p.name) === clave)) {
      throw new BadRequestException(
        `Ya existe un pipeline llamado «${name}» en esta empresa`,
      );
    }
  }

  async create(
    companyId: string,
    data: { name: string; isDefault?: boolean; order?: number },
  ) {
    const name = normalizarNombre(
      data.name,
      PIPELINE_LIMITS.maxNameLength,
      'del pipeline',
    );
    // Marcar predeterminado desmarca el anterior EN LA MISMA TRANSACCIÓN. El
    // índice parcial `pipelines_one_default_per_company` lo garantiza a nivel
    // de base; hacerlo aquí evita que el usuario vea un error de constraint
    // por una operación que sí es legítima.
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.asegurarNombreDePipelineLibre(tx, companyId, name);
        // Sin orden explícito entra al final, no en el 0: el orden del
        // selector es determinista sin que la pantalla tenga que reordenar.
        let order = data.order;
        if (order === undefined) {
          const ultimo = await tx.pipeline.findFirst({
            where: { companyId },
            orderBy: { order: 'desc' },
            select: { order: true },
          });
          order = ultimo ? ultimo.order + 1 : 0;
        }
        if (data.isDefault) {
          await tx.pipeline.updateMany({
            where: { companyId, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.pipeline.create({
          data: { name, isDefault: data.isDefault ?? false, order, companyId },
        });
      });
    } catch (e) {
      if (esConflictoDeDefault(e)) {
        throw new ConflictException(
          'Otro cambio marcó un pipeline predeterminado al mismo tiempo. Vuelve a intentarlo.',
        );
      }
      throw e;
    }
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

    const name =
      data.name !== undefined
        ? normalizarNombre(
            data.name,
            PIPELINE_LIMITS.maxNameLength,
            'del pipeline',
          )
        : undefined;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (name !== undefined) {
          await this.asegurarNombreDePipelineLibre(tx, companyId, name, id);
        }
        if (data.isDefault) {
          await tx.pipeline.updateMany({
            where: { companyId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.pipeline.update({
          where: { id },
          data: { ...data, ...(name !== undefined ? { name } : {}) },
        });
      });
    } catch (e) {
      if (esConflictoDeDefault(e)) {
        throw new ConflictException(
          'Otro cambio marcó un pipeline predeterminado al mismo tiempo. Vuelve a intentarlo.',
        );
      }
      throw e;
    }
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

  /**
   * Bloquea la fila del embudo dentro de la transacción: dos ediciones de
   * etapas del mismo embudo se serializan en vez de pisarse (dos WON, dos
   * posiciones iguales, dos «iniciales»). El bloqueo va SIEMPRE con el
   * `companyId`, así que un embudo ajeno responde 404 sin bloquear nada.
   */
  private async bloquearPipeline(
    tx: Tx,
    pipelineId: string,
    companyId: string,
  ) {
    const filas = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "pipelines"
      WHERE "id" = ${pipelineId} AND "companyId" = ${companyId}
      FOR UPDATE
    `;
    if (filas.length === 0) {
      throw new NotFoundException('Pipeline no encontrado');
    }
    return tx.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private asegurarNombreDeEtapaLibre(
    etapas: { id: string; name: string }[],
    name: string,
    exceptoId?: string,
  ): void {
    const clave = claveDeNombre(name);
    if (
      etapas.some((s) => s.id !== exceptoId && claveDeNombre(s.name) === clave)
    ) {
      throw new BadRequestException(
        `Ya existe una etapa llamada «${name}» en este pipeline`,
      );
    }
  }

  /**
   * Un embudo tiene UNA etapa ganada y UNA perdida: son las que cierran la
   * oportunidad y con dos de cada, el reporte y las automatizaciones no saben
   * cuál cuenta. Se comprueba al crear y al cambiar el tipo.
   */
  private asegurarCierreUnico(
    etapas: { id: string; type: StageType }[],
    type: StageType,
    exceptoId?: string,
  ): void {
    if (type === 'OPEN') return;
    if (etapas.some((s) => s.id !== exceptoId && s.type === type)) {
      throw new BadRequestException(
        `El pipeline ya tiene una etapa ${TIPO_EN_ESPANOL[type]}. Cambia esa etapa en vez de crear otra del mismo tipo.`,
      );
    }
  }

  /**
   * «Nunca peor que antes»: una edición no puede dejar al embudo sin la única
   * etapa de un tipo que hoy tiene (la última abierta, ganada o perdida). Un
   * embudo anterior a la fase sin etapa ganada sigue editable; simplemente no
   * se le puede quitar lo que ya tiene.
   */
  private asegurarQueNoDesapareceElUltimoTipo(
    etapas: { id: string; type: StageType }[],
    stageId: string,
    typeActual: StageType,
    accion: 'eliminar' | 'cambiar',
  ): void {
    const restantesDelTipo = etapas.filter(
      (s) => s.id !== stageId && s.type === typeActual,
    ).length;
    if (restantesDelTipo === 0) {
      throw new BadRequestException(
        accion === 'eliminar'
          ? `No se puede eliminar la única etapa ${TIPO_EN_ESPANOL[typeActual]} del pipeline. Crea o marca otra antes.`
          : `No se puede cambiar el tipo de la única etapa ${TIPO_EN_ESPANOL[typeActual]} del pipeline. Crea o marca otra antes.`,
      );
    }
  }

  async createStage(
    pipelineId: string,
    companyId: string,
    data: {
      name: string;
      order?: number;
      color?: string;
      probability?: number;
      type?: StageType;
      isInitial?: boolean;
    },
  ) {
    const name = normalizarNombre(
      data.name,
      STAGE_LIMITS.maxNameLength,
      'de la etapa',
    );
    const type: StageType = data.type ?? 'OPEN';

    return this.prisma.$transaction(async (tx) => {
      const etapas = await this.bloquearPipeline(tx, pipelineId, companyId);

      if (etapas.length >= STAGE_LIMITS.maxCount) {
        throw new BadRequestException(
          `Un pipeline admite como máximo ${STAGE_LIMITS.maxCount} etapas`,
        );
      }
      this.asegurarNombreDeEtapaLibre(etapas, name);
      this.asegurarCierreUnico(etapas, type);

      let order = data.order;
      if (order === undefined) {
        const ultima = etapas[etapas.length - 1];
        order = ultima ? ultima.order + 1 : 0;
      }

      // Una etapa inicial y solo una por embudo. Si la nueva lo es, la anterior
      // deja de serlo en la MISMA transacción: con dos marcadas, cuál recibe al
      // cliente que acaba de escribir depende del orden de la consulta, y eso no
      // se puede depurar mirando la pantalla.
      if (data.isInitial) {
        await tx.pipelineStage.updateMany({
          where: { pipelineId, isInitial: true },
          data: { isInitial: false },
        });
      }
      return tx.pipelineStage.create({
        data: { ...data, name, type, order, pipelineId },
      });
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
      type?: StageType;
      isInitial?: boolean;
    },
  ) {
    const name =
      data.name !== undefined
        ? normalizarNombre(data.name, STAGE_LIMITS.maxNameLength, 'de la etapa')
        : undefined;

    return this.prisma.$transaction(async (tx) => {
      const etapas = await this.bloquearPipeline(tx, pipelineId, companyId);
      const stage = etapas.find((s) => s.id === stageId);
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

      if (name !== undefined) {
        this.asegurarNombreDeEtapaLibre(etapas, name, stageId);
      }

      if (data.type !== undefined && data.type !== stage.type) {
        this.asegurarQueNoDesapareceElUltimoTipo(
          etapas,
          stageId,
          stage.type,
          'cambiar',
        );
        this.asegurarCierreUnico(etapas, data.type, stageId);
      }

      if (data.isInitial) {
        await tx.pipelineStage.updateMany({
          where: { pipelineId, isInitial: true, id: { not: stageId } },
          data: { isInitial: false },
        });
      }

      return tx.pipelineStage.update({
        where: { id: stageId },
        data: { ...data, ...(name !== undefined ? { name } : {}) },
      });
    });
  }

  async removeStage(pipelineId: string, stageId: string, companyId: string) {
    return this.prisma.$transaction(async (tx) => {
      const etapas = await this.bloquearPipeline(tx, pipelineId, companyId);
      const stage = etapas.find((s) => s.id === stageId);
      if (!stage) throw new NotFoundException('Etapa no encontrada');

      const leadCount = await tx.lead.count({
        where: { stageId, companyId },
      });
      if (leadCount > 0) {
        throw new BadRequestException(
          `No se puede eliminar una etapa con ${leadCount} ${
            leadCount === 1 ? 'oportunidad' : 'oportunidades'
          }. Mueve las oportunidades a otra etapa primero.`,
        );
      }

      const otras = etapas.filter((s) => s.id !== stageId);

      // Borrar la etapa de entrada deja el embudo sin puerta: el siguiente
      // mensaje caería en «la primera por orden», que puede ser «Ganado».
      if (stage.isInitial && otras.length > 0) {
        throw new BadRequestException(
          'Esa es la etapa de entrada del embudo. Marca otra como inicial antes de borrarla.',
        );
      }

      // Mientras queden otras etapas, no se puede quitar la única de su tipo.
      if (otras.length > 0) {
        this.asegurarQueNoDesapareceElUltimoTipo(
          etapas,
          stageId,
          stage.type,
          'eliminar',
        );
      }

      return tx.pipelineStage.delete({ where: { id: stageId } });
    });
  }

  /**
   * Reordena TODAS las etapas del embudo de una vez. La lista debe traer cada
   * etapa exactamente una vez y las posiciones 0..n-1 sin huecos: un orden
   * parcial o con repetidos deja dos etapas en la misma posición y el tablero
   * las pinta en un orden que nadie eligió.
   */
  async reorderStages(
    pipelineId: string,
    companyId: string,
    stages: { id: string; order: number }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const etapas = await this.bloquearPipeline(tx, pipelineId, companyId);

      const ids = new Set(stages.map((s) => s.id));
      if (ids.size !== stages.length) {
        throw new BadRequestException('Hay etapas repetidas en el orden');
      }
      const propias = new Set(etapas.map((s) => s.id));
      if (stages.some((s) => !propias.has(s.id))) {
        throw new BadRequestException(
          'Una o más etapas no pertenecen a este pipeline',
        );
      }
      if (stages.length !== etapas.length) {
        throw new BadRequestException(
          'El orden debe incluir todas las etapas del pipeline',
        );
      }
      const posiciones = stages.map((s) => s.order).sort((a, b) => a - b);
      if (posiciones.some((p, i) => p !== i)) {
        throw new BadRequestException(
          'Las posiciones deben ser 0, 1, 2… sin huecos ni repetidos',
        );
      }

      const actualizadas: PipelineStage[] = [];
      for (const s of stages) {
        actualizadas.push(
          await tx.pipelineStage.update({
            where: { id: s.id },
            data: { order: s.order },
          }),
        );
      }
      return actualizadas;
    });
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
