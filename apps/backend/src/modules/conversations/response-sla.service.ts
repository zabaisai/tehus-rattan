import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { shouldRunScheduledJobs } from '../../common/scheduling/scheduling.role';

/** Cuántas conversaciones se revisan por pasada. */
export const MAXIMO_POR_PASADA = 200;

export interface Incumplimiento {
  conversationId: string;
  companyId: string;
  assignedTo: string | null;
  /** Minutos que lleva esperando el cliente. */
  esperaMinutos: number;
}

/**
 * SLA de primera respuesta.
 *
 * QUÉ MIDE: cuánto lleva esperando un cliente que escribió y todavía no ha
 * recibido respuesta. Es el único indicador de esta clase que un cliente nota
 * directamente — los demás (tareas vencidas, oportunidades estancadas) los
 * sufre el equipo, este lo sufre quien paga.
 *
 * LA CONDICIÓN es "el último mensaje de la conversación es ENTRANTE y tiene
 * más de N minutos". No vale mirar solo el primer mensaje: una conversación
 * contestada hace una semana que recibe un mensaje nuevo hoy vuelve a estar
 * esperando, y quedarse con el primero la daría por atendida para siempre.
 *
 * `responseSlaMinutes` nulo significa **sin compromiso definido**, que no es
 * lo mismo que cero: una empresa que no ha configurado SLA no debe recibir
 * una alarma por cada conversación abierta.
 */
@Injectable()
export class ResponseSlaService {
  private readonly logger = new Logger(ResponseSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cada cinco minutos: suficiente para que un SLA de 15 minutos avise a
   * tiempo, sin barrer la base continuamente.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async revisar(): Promise<number> {
    // En un solo proceso. Sin esto, backend y worker avisarían por separado.
    if (!shouldRunScheduledJobs()) return 0;

    try {
      const incumplimientos = await this.detectar();
      for (const caso of incumplimientos) await this.avisar(caso);
      return incumplimientos.length;
    } catch (error) {
      this.logger.warn(
        `No se pudo revisar el SLA de respuesta [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
      return 0;
    }
  }

  /**
   * Conversaciones cuyo último mensaje es entrante y lleva más tiempo del
   * comprometido por su empresa.
   *
   * Va en SQL porque la condición cruza tres cosas —el último mensaje de cada
   * conversación, su dirección y el umbral de SU empresa— y compararlas en
   * memoria obligaría a traerse todas las conversaciones abiertas.
   */
  async detectar(): Promise<Incumplimiento[]> {
    return this.prisma.$queryRaw<Incumplimiento[]>`
      SELECT
        c.id                AS "conversationId",
        c."companyId"       AS "companyId",
        c."assignedTo"      AS "assignedTo",
        FLOOR(EXTRACT(EPOCH FROM (NOW() - ultimo."createdAt")) / 60)::int
                            AS "esperaMinutos"
      FROM conversations c
      JOIN companies emp ON emp.id = c."companyId"
      JOIN LATERAL (
        SELECT m.direction, m."createdAt"
        FROM messages m
        WHERE m."conversationId" = c.id
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) ultimo ON TRUE
      WHERE emp."responseSlaMinutes" IS NOT NULL
        AND c.status NOT IN ('RESOLVED', 'CLOSED', 'ARCHIVED')
        -- Una conversacion pausada esta en manos del chatbot o del cliente a
        -- proposito: contarla como incumplida seria castigar una decision
        -- deliberada del equipo.
        AND c."isPaused" = FALSE
        AND ultimo.direction = 'INBOUND'::"Direction"
        AND ultimo."createdAt" <
            NOW() - (emp."responseSlaMinutes" || ' minutes')::interval
      ORDER BY ultimo."createdAt" ASC
      LIMIT ${MAXIMO_POR_PASADA}
    `;
  }

  /**
   * Avisa al responsable, y a los administradores si no hay nadie asignado:
   * una conversación incumplida sin dueño no tiene a quién reclamarle, y es
   * justo la que más urge.
   *
   * Deduplicado en cubos de una hora por conversación. Sin cubo, la misma
   * conversación avisaría cada cinco minutos hasta que alguien contestara y
   * el aviso se volvería ruido que se aprende a ignorar; sin ningún límite
   * temporal, un aviso único se perdería y nadie volvería a saber de ella.
   */
  private async avisar(caso: Incumplimiento): Promise<void> {
    const cubo = Math.floor(Date.now() / 3_600_000);
    const base = {
      companyId: caso.companyId,
      type: 'SLA_RESPONSE_BREACHED' as const,
      title: 'Conversación sin responder',
      bodyPreview: `Lleva ${caso.esperaMinutos} minutos esperando respuesta.`,
      entityType: 'Conversation',
      entityId: caso.conversationId,
      actionUrl: '/dashboard/conversations',
    };

    if (caso.assignedTo) {
      await this.notifications.emit({
        ...base,
        recipientUserId: caso.assignedTo,
        dedupeKey: `SLA_RESPONSE:${caso.conversationId}:${cubo}`,
      });
      return;
    }

    await this.notifications.emitToCompanyRoles(caso.companyId, ['ADMIN'], {
      ...base,
      title: 'Conversación sin responder y sin asesor',
      dedupeKey: `SLA_RESPONSE_UNASSIGNED:${caso.conversationId}:${cubo}`,
    });
  }
}
