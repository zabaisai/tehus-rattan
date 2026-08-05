import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Configuración de entrada de oportunidades, ya resuelta.
 *
 * `pipelineId` y `stageId` nulos significan que NO se puede colocar la
 * oportunidad. No es un error del mensaje: el contacto, la conversación y el
 * texto se guardan igual. Lo que no se hace es inventar un pipeline.
 */
export interface EntradaResuelta {
  autoCreateLead: boolean;
  pipelineId: string | null;
  stageId: string | null;
  reuseOpenLead: boolean;
  createInitialTask: boolean;
  initialTaskTitle: string;
  initialTaskDueHours: number;
  assignmentStrategy: 'NINGUNA' | 'ROUND_ROBIN' | 'FIJA';
  assignedUserId: string | null;
  reactivateArchived: boolean;
  /** Por qué no hay dónde colocarla, cuando no la hay. */
  motivo?: 'sin-pipeline' | 'sin-etapa-inicial';
}

/** Lo que se aplica a una empresa que nunca ha configurado nada. */
export const POR_DEFECTO = {
  autoCreateLead: true,
  reuseOpenLead: true,
  createInitialTask: false,
  initialTaskTitle: 'Primer contacto',
  initialTaskDueHours: 24,
  assignmentStrategy: 'ROUND_ROBIN' as const,
  reactivateArchived: true,
};

/**
 * Resuelve qué hacer cuando entra un mensaje de alguien nuevo.
 *
 * TODA REFERENCIA SE COMPRUEBA CONTRA LA EMPRESA. Una configuración puede
 * quedar apuntando a un pipeline o una etapa que después se borraron o —peor—
 * que pertenecen a otra empresa si alguien manipuló la petición que los
 * guardó. Aceptarlos a ciegas metería oportunidades de una empresa en el
 * tablero de otra, que es la peor fuga posible en un CRM multiempresa.
 *
 * Cuando una referencia no vale, se cae al valor por defecto en vez de fallar:
 * el mensaje del cliente no puede perderse por una configuración caduca.
 */
@Injectable()
export class LeadSettingsService {
  private readonly logger = new Logger(LeadSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolver(
    companyId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<EntradaResuelta> {
    const config = await tx.companyLeadSettings.findUnique({
      where: { companyId },
    });

    const base: EntradaResuelta = {
      autoCreateLead: config?.autoCreateLead ?? POR_DEFECTO.autoCreateLead,
      pipelineId: null,
      stageId: null,
      reuseOpenLead: config?.reuseOpenLead ?? POR_DEFECTO.reuseOpenLead,
      createInitialTask:
        config?.createInitialTask ?? POR_DEFECTO.createInitialTask,
      initialTaskTitle:
        config?.initialTaskTitle?.trim() || POR_DEFECTO.initialTaskTitle,
      initialTaskDueHours:
        config?.initialTaskDueHours ?? POR_DEFECTO.initialTaskDueHours,
      assignmentStrategy:
        config?.assignmentStrategy ?? POR_DEFECTO.assignmentStrategy,
      assignedUserId: null,
      reactivateArchived:
        config?.reactivateArchived ?? POR_DEFECTO.reactivateArchived,
    };

    if (!base.autoCreateLead) return base;

    // ── pipeline ──────────────────────────────────────────────
    // El configurado, SIEMPRE comprobando que sea de esta empresa y siga vivo.
    let pipelineId: string | null = null;
    if (config?.defaultPipelineId) {
      const elegido = await tx.pipeline.findFirst({
        where: {
          id: config.defaultPipelineId,
          companyId,
          isArchived: false,
        },
        select: { id: true },
      });
      pipelineId = elegido?.id ?? null;
      if (!pipelineId) {
        this.logger.warn(
          `La empresa tiene configurado un pipeline que ya no vale; se usa el predeterminado`,
        );
      }
    }

    if (!pipelineId) {
      const predeterminado = await tx.pipeline.findFirst({
        where: { companyId, isDefault: true, isArchived: false },
        select: { id: true },
      });
      pipelineId = predeterminado?.id ?? null;
    }

    // Sin predeterminado, cualquiera activo antes que ninguno: una empresa con
    // un solo pipeline sin marcar como predeterminado no debe quedarse sin
    // entrada de oportunidades por un detalle de configuración.
    if (!pipelineId) {
      const cualquiera = await tx.pipeline.findFirst({
        where: { companyId, isArchived: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      pipelineId = cualquiera?.id ?? null;
    }

    if (!pipelineId) return { ...base, motivo: 'sin-pipeline' };

    // ── etapa ─────────────────────────────────────────────────
    let stageId: string | null = null;
    if (config?.initialStageId) {
      // La etapa debe pertenecer AL PIPELINE ELEGIDO, no solo a la empresa:
      // una etapa de otro pipeline dejaría la oportunidad en un tablero y la
      // etapa en otro.
      const elegida = await tx.pipelineStage.findFirst({
        where: { id: config.initialStageId, pipelineId },
        select: { id: true },
      });
      stageId = elegida?.id ?? null;
    }

    if (!stageId) {
      const inicial = await tx.pipelineStage.findFirst({
        where: { pipelineId, isInitial: true },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      stageId = inicial?.id ?? null;
    }

    // Reserva: la primera por orden. Es el comportamiento anterior al campo
    // `isInitial`, y cubre un pipeline creado antes del backfill.
    if (!stageId) {
      const primera = await tx.pipelineStage.findFirst({
        where: { pipelineId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      stageId = primera?.id ?? null;
    }

    if (!stageId) {
      return { ...base, pipelineId, motivo: 'sin-etapa-inicial' };
    }

    // ── responsable fijo ──────────────────────────────────────
    let assignedUserId: string | null = null;
    if (base.assignmentStrategy === 'FIJA' && config?.assignedUserId) {
      const usuario = await tx.user.findFirst({
        where: { id: config.assignedUserId, companyId, isActive: true },
        select: { id: true },
      });
      assignedUserId = usuario?.id ?? null;
    }

    return { ...base, pipelineId, stageId, assignedUserId };
  }

  /**
   * Configuración actual de una empresa, para la pantalla de ajustes.
   * Devuelve los valores por defecto si nunca se guardó nada, para que la
   * interfaz muestre lo que realmente se está aplicando.
   */
  async obtener(companyId: string) {
    const config = await this.prisma.companyLeadSettings.findUnique({
      where: { companyId },
    });
    return (
      config ?? {
        companyId,
        ...POR_DEFECTO,
        defaultPipelineId: null,
        initialStageId: null,
        initialTaskTitle: POR_DEFECTO.initialTaskTitle,
        assignedUserId: null,
      }
    );
  }
}
