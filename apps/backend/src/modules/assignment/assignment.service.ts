import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Cliente de Prisma o transacción: el reparto debe poder ir dentro de una. */
type Writer = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** Roles que atienden conversaciones. Un SUPER_ADMIN de plataforma no. */
const ROLES_ELEGIBLES = ['AGENT', 'ADMIN'] as const;

/**
 * Reparto automático de conversaciones y oportunidades entrantes.
 *
 * ROUND-ROBIN POR `lastAssignedAt`, NO POR CONTADOR EN MEMORIA.
 *
 * Le toca siempre a quien lleva más tiempo sin recibir. Esa marca vive en la
 * fila del usuario, así que el turno sobrevive a reinicios y funciona con el
 * backend y el worker a la vez. Un contador en memoria parece más simple hasta
 * que hay dos procesos: entonces cada uno lleva su propio turno y el reparto
 * empieza a repetir persona sin que nadie entienda por qué.
 *
 * Sin nadie elegible NO se inventa un responsable: la conversación entra a la
 * bandeja sin asignar y se avisa a los administradores. Asignar a alguien
 * inactivo sería peor que no asignar, porque nadie la vería y además parecería
 * atendida.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Elige al siguiente asesor y anota su turno, todo dentro del `writer` que
   * se le pase para que la elección y su marca sean atómicas: si la operación
   * que la envuelve se revierte, el turno no se consume.
   *
   * Devuelve `null` si la empresa tiene el reparto apagado o no hay nadie
   * elegible. El llamador decide qué hacer con eso; aquí no se inventa nada.
   */
  async pickNextAgent(
    companyId: string,
    writer: Writer = this.prisma,
  ): Promise<string | null> {
    const company = await writer.company.findUnique({
      where: { id: companyId },
      select: { autoAssignEnabled: true },
    });

    if (!company?.autoAssignEnabled) return null;

    const candidato = await writer.user.findFirst({
      where: {
        companyId,
        isActive: true,
        autoAssignEnabled: true,
        role: { in: ROLES_ELEGIBLES as unknown as never },
      },
      // Nulls first: quien nunca ha recibido nada entra el primero, para que
      // un asesor recién incorporado no espere una vuelta entera.
      orderBy: [{ lastAssignedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      select: { id: true },
    });

    if (!candidato) return null;

    await writer.user.update({
      where: { id: candidato.id },
      data: { lastAssignedAt: new Date() },
    });

    return candidato.id;
  }

  /**
   * Aviso a los administradores de que algo entró sin responsable.
   *
   * Best-effort y fuera de la transacción: que falle el aviso no puede
   * impedir que la conversación se guarde. Deduplicado por empresa en cubos
   * de una hora, porque el caso típico —nadie elegible— se repetiría con cada
   * mensaje y convertiría la campana en ruido.
   */
  async warnNobodyAvailable(companyId: string): Promise<void> {
    const cubo = Math.floor(Date.now() / 3_600_000);
    await this.notifications.emitToCompanyRoles(companyId, ['ADMIN'], {
      type: 'UNASSIGNED_CONVERSATION',
      title: 'Conversaciones sin asesor asignado',
      bodyPreview:
        'No hay asesores disponibles para el reparto automático. Están entrando a la bandeja sin asignar.',
      entityType: 'Company',
      entityId: companyId,
      actionUrl: '/dashboard/conversations',
      dedupeKey: `UNASSIGNED_CONVERSATION:${companyId}:${cubo}`,
    });
  }
}
