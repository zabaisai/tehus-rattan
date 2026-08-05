import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAuditLogService } from '../../platform/platform-audit-log.service';

/** Solo puede haber uno. El identificador es fijo a propósito. */
export const ID_KILL_SWITCH = 'global';

export interface EstadoKillSwitch {
  activo: boolean;
  motivo: string | null;
  activadoEn: Date | null;
  activadoPor: string | null;
}

/**
 * El interruptor de emergencia de los envíos de FlowBot.
 *
 * QUÉ PARA Y QUÉ NO. Para los envíos de los BOTS. No toca los mensajes que
 * escribe una persona desde el CRM, no cancela ejecuciones, no borra trabajos
 * de la cola y no pierde nada: las ejecuciones se quedan donde están y quedan
 * marcadas con un motivo explicable. Apagar también los mensajes manuales
 * convertiría una pausa de seguridad en una interrupción del negocio, que es
 * exactamente lo que hace que nadie se atreva a usar el interruptor.
 *
 * FAIL-CLOSED. Si la consulta falla —base caída, tabla ausente, permiso— se
 * responde «activo». Un interruptor de emergencia que se abre solo cuando no
 * puede comprobarse no es un interruptor: es una recomendación.
 *
 * SIN CACHÉ. Se lee en cada envío. Guardarlo un minuto significaría que la
 * pausa tarda un minuto en surtir efecto, y el minuto en el que hace falta
 * pararlo es el minuto en el que está saliendo lo que no debía.
 */
@Injectable()
export class FlowBotKillSwitchService {
  private readonly logger = new Logger(FlowBotKillSwitchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: PlatformAuditLogService,
  ) {}

  /** ¿Están los envíos parados? Ante la duda, sí. */
  async activo(): Promise<boolean> {
    try {
      const fila = await this.prisma.flowBotKillSwitch.findUnique({
        where: { id: ID_KILL_SWITCH },
        select: { active: true },
      });
      // Sin fila, los envíos NO están parados: es el estado normal de una
      // instalación recién montada. Lo que no puede pasar es que un ERROR al
      // consultar se interprete como «no está parado».
      return fila?.active ?? false;
    } catch (error) {
      this.logger.error(
        'No se pudo leer el interruptor de emergencia; se asume ACTIVO',
        error as Error,
      );
      return true;
    }
  }

  async estado(): Promise<EstadoKillSwitch> {
    try {
      const fila = await this.prisma.flowBotKillSwitch.findUnique({
        where: { id: ID_KILL_SWITCH },
        select: {
          active: true,
          reason: true,
          activatedAt: true,
          activatedBy: { select: { name: true } },
        },
      });
      return {
        activo: fila?.active ?? false,
        motivo: fila?.reason ?? null,
        activadoEn: fila?.activatedAt ?? null,
        activadoPor: fila?.activatedBy?.name ?? null,
      };
    } catch {
      return {
        activo: true,
        motivo: 'No se pudo leer el estado; se asume parado por seguridad',
        activadoEn: null,
        activadoPor: null,
      };
    }
  }

  /**
   * Enciende o apaga el interruptor.
   *
   * Exige motivo al ACTIVAR. «¿Por qué están parados los bots?» es la primera
   * pregunta que se hace cinco minutos después, y sin esto la respuesta hay
   * que reconstruirla preguntando a la gente.
   */
  async cambiar(input: {
    activo: boolean;
    motivo?: string;
    actorUserId: string;
    actorRole: string;
  }): Promise<EstadoKillSwitch> {
    const motivo = input.motivo?.trim() || null;

    await this.prisma.flowBotKillSwitch.upsert({
      where: { id: ID_KILL_SWITCH },
      create: {
        id: ID_KILL_SWITCH,
        active: input.activo,
        reason: motivo,
        activatedAt: input.activo ? new Date() : null,
        activatedById: input.activo ? input.actorUserId : null,
      },
      update: {
        active: input.activo,
        reason: motivo,
        activatedAt: input.activo ? new Date() : null,
        activatedById: input.activo ? input.actorUserId : null,
      },
    });

    // La auditoría NO se traga el fallo aquí: parar los bots de todas las
    // empresas sin dejar rastro es peor que no poder pararlos.
    await this.auditoria.record(this.prisma, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole as never,
      action: input.activo ? 'flowbot.killswitch.on' : 'flowbot.killswitch.off',
      entityType: 'FlowBotKillSwitch',
      entityId: ID_KILL_SWITCH,
      ...(motivo ? { reason: motivo } : {}),
    });

    this.logger.warn(
      `Interruptor de emergencia de FlowBot ${
        input.activo ? 'ACTIVADO' : 'desactivado'
      } por ${input.actorUserId}`,
    );

    return this.estado();
  }
}
