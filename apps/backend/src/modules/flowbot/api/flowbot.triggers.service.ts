import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FlowBotTriggerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { dentroDeHorario } from '../../../common/time/zona-horaria';
import { DisparadorDto } from './flowbot.contracts';

/**
 * Disparadores de un bot: qué lo despierta, con qué prioridad y con qué
 * filtros.
 *
 * TODO SE ACOTA A TRAVÉS DEL BOT. Un disparador no tiene `companyId` propio
 * —cuelga del bot— así que cada consulta filtra por `flowBot: { companyId }`.
 * Sin eso, un `triggerId` de otra empresa se podría editar con solo conocerlo.
 */
@Injectable()
export class FlowBotTriggersService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(companyId: string, botId: string): Promise<DisparadorDto[]> {
    await this.exigirBot(companyId, botId);

    const triggers = await this.prisma.flowBotTrigger.findMany({
      where: { flowBotId: botId, flowBot: { companyId } },
      // Mismo orden que usa el selector en ejecución: prioridad primero. Ver
      // la lista en otro orden que el que decide quién responde confundiría a
      // quien la configura.
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return triggers.map((t) => this.aDto(t));
  }

  async crear(
    companyId: string,
    botId: string,
    entrada: {
      tipo: FlowBotTriggerType;
      activo?: boolean;
      prioridad?: number;
      exclusivo?: boolean;
      filtros?: unknown;
      whatsappIntegrationId?: string | null;
      scheduleSpec?: string | null;
    },
  ): Promise<DisparadorDto> {
    await this.exigirBot(companyId, botId);
    await this.validarFiltros(companyId, entrada);

    const t = await this.prisma.flowBotTrigger.create({
      data: {
        flowBotId: botId,
        type: entrada.tipo,
        enabled: entrada.activo ?? true,
        priority: entrada.prioridad ?? 0,
        exclusive: entrada.exclusivo ?? true,
        filters: (entrada.filtros as Prisma.InputJsonValue) ?? Prisma.DbNull,
        whatsappIntegrationId: entrada.whatsappIntegrationId ?? null,
        scheduleSpec: entrada.scheduleSpec ?? null,
      },
    });
    return this.aDto(t);
  }

  async actualizar(
    companyId: string,
    botId: string,
    triggerId: string,
    cambios: {
      activo?: boolean;
      prioridad?: number;
      exclusivo?: boolean;
      filtros?: unknown;
      whatsappIntegrationId?: string | null;
      scheduleSpec?: string | null;
    },
  ): Promise<DisparadorDto> {
    await this.exigirBot(companyId, botId);
    await this.validarFiltros(companyId, cambios);

    const { count } = await this.prisma.flowBotTrigger.updateMany({
      where: { id: triggerId, flowBotId: botId, flowBot: { companyId } },
      data: {
        ...(cambios.activo !== undefined ? { enabled: cambios.activo } : {}),
        ...(cambios.prioridad !== undefined
          ? { priority: cambios.prioridad }
          : {}),
        ...(cambios.exclusivo !== undefined
          ? { exclusive: cambios.exclusivo }
          : {}),
        ...(cambios.filtros !== undefined
          ? {
              filters:
                (cambios.filtros as Prisma.InputJsonValue) ?? Prisma.DbNull,
            }
          : {}),
        ...(cambios.whatsappIntegrationId !== undefined
          ? { whatsappIntegrationId: cambios.whatsappIntegrationId }
          : {}),
        ...(cambios.scheduleSpec !== undefined
          ? { scheduleSpec: cambios.scheduleSpec }
          : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Disparador no encontrado');

    const t = await this.prisma.flowBotTrigger.findFirst({
      where: { id: triggerId, flowBot: { companyId } },
    });
    return this.aDto(t!);
  }

  async eliminar(companyId: string, botId: string, triggerId: string) {
    await this.exigirBot(companyId, botId);
    const { count } = await this.prisma.flowBotTrigger.deleteMany({
      where: { id: triggerId, flowBotId: botId, flowBot: { companyId } },
    });
    if (count === 0) throw new NotFoundException('Disparador no encontrado');
    return { eliminado: true };
  }

  /**
   * Reordena las prioridades de golpe.
   *
   * EN UNA TRANSACCIÓN. Aplicarlas una a una dejaría, si falla en medio, un
   * orden a medio cambiar en el que dos bots creerían tener la máxima
   * prioridad — y con exclusividad, cuál responde dependería del azar.
   */
  async ordenar(
    companyId: string,
    botId: string,
    orden: Array<{ triggerId: string; prioridad: number }>,
  ) {
    await this.exigirBot(companyId, botId);

    await this.prisma.$transaction(
      orden.map((o) =>
        this.prisma.flowBotTrigger.updateMany({
          where: { id: o.triggerId, flowBotId: botId, flowBot: { companyId } },
          data: { priority: o.prioridad },
        }),
      ),
    );
    return this.listar(companyId, botId);
  }

  /**
   * Comprueba lo que el disparador referencia contra ESTA empresa.
   *
   * Un `whatsappIntegrationId` o un `stageId` de otra empresa haría que un bot
   * arrancara con el número de un tercero o moviera oportunidades a su
   * tablero. La clave ajena apunta a la tabla, no a la empresa, así que la
   * base no lo impediría sola.
   */
  private async validarFiltros(
    companyId: string,
    entrada: { whatsappIntegrationId?: string | null; filtros?: unknown },
  ): Promise<void> {
    if (entrada.whatsappIntegrationId) {
      const numero = await this.prisma.whatsAppIntegration.findFirst({
        where: {
          id: entrada.whatsappIntegrationId,
          companyId,
          status: 'CONNECTED',
        },
        select: { id: true },
      });
      if (!numero) {
        throw new BadRequestException(
          'Ese número de WhatsApp no existe, no está conectado o es de otra empresa',
        );
      }
    }

    const f = entrada.filtros;
    if (!f || typeof f !== 'object') return;
    const filtros = f as Record<string, unknown>;

    if (typeof filtros.pipelineId === 'string') {
      const p = await this.prisma.pipeline.findFirst({
        where: { id: filtros.pipelineId, companyId },
        select: { id: true },
      });
      if (!p)
        throw new BadRequestException('Ese pipeline no es de esta empresa');
    }
    if (typeof filtros.stageId === 'string') {
      const e = await this.prisma.pipelineStage.findFirst({
        where: { id: filtros.stageId, pipeline: { companyId } },
        select: { id: true },
      });
      if (!e) throw new BadRequestException('Esa etapa no es de esta empresa');
    }

    // El horario se valida AQUÍ y no solo en ejecución: un horario imposible
    // guardado en silencio deja el bot mudo y nadie sabe por qué.
    if (filtros.businessHours && typeof filtros.businessHours === 'object') {
      const prueba = dentroDeHorario(
        new Date(),
        'America/Bogota',
        filtros.businessHours,
      );
      if (prueba === null) {
        throw new BadRequestException(
          'El horario no es válido: revisa la hora de apertura y de cierre (0 a 23)',
        );
      }
    }
  }

  private async exigirBot(companyId: string, botId: string): Promise<void> {
    const bot = await this.prisma.flowBot.findFirst({
      where: { id: botId, companyId },
      select: { id: true },
    });
    if (!bot) throw new NotFoundException('Bot no encontrado');
  }

  private aDto(t: {
    id: string;
    type: string;
    enabled: boolean;
    priority: number;
    exclusive: boolean;
    filters: unknown;
    whatsappIntegrationId: string | null;
    scheduleSpec: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): DisparadorDto {
    return {
      id: t.id,
      tipo: t.type,
      activo: t.enabled,
      prioridad: t.priority,
      exclusivo: t.exclusive,
      filtros: t.filters,
      whatsappIntegrationId: t.whatsappIntegrationId,
      scheduleSpec: t.scheduleSpec,
      creadoEn: t.createdAt.toISOString(),
      actualizadoEn: t.updatedAt.toISOString(),
    };
  }
}
