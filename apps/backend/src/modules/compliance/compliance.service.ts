import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

/** Meses mínimos de retención: por debajo, se está borrando el trabajo en curso. */
export const RETENCION_MINIMA_MESES = 3;

/**
 * Retención, exportación y eliminación de datos.
 *
 * TRES REGLAS QUE VIENEN DE QUE ESTO ES IRREVERSIBLE
 *
 * 1. **Por defecto no se purga nada.** `retentionMonths` nulo significa
 *    "conservar indefinidamente". Un valor por defecto que borre el historial
 *    comercial de una empresa que nunca lo pidió no es una política de
 *    retención, es una pérdida de datos con calendario.
 *
 * 2. **La purga exige dos señales**, no una: un plazo Y un interruptor
 *    explícito. Con una sola, un `retentionMonths` puesto por error —o
 *    heredado de una plantilla— empieza a borrar solo.
 *
 * 3. **La eliminación no se ejecuta al pedirla.** Se registra, queda
 *    pendiente y exige aprobación aparte. Un endpoint que borre el historial
 *    completo en una llamada es justo lo que no debe existir: irreversible,
 *    disparable por error y sin rastro de quién lo pidió.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditLogService,
  ) {}

  // ── configuración ───────────────────────────────────────────

  async getRetention(companyId: string) {
    const empresa = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { retentionMonths: true, retentionPurgeEnabled: true },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    return empresa;
  }

  async setRetention(
    companyId: string,
    datos: { retentionMonths?: number | null; retentionPurgeEnabled?: boolean },
    actor: { userId: string; role: string },
  ) {
    if (
      datos.retentionMonths !== undefined &&
      datos.retentionMonths !== null &&
      datos.retentionMonths < RETENCION_MINIMA_MESES
    ) {
      throw new BadRequestException(
        `La retención mínima es de ${RETENCION_MINIMA_MESES} meses: por debajo se estaría borrando trabajo en curso.`,
      );
    }

    // Activar la purga sin plazo no significa nada, y dejarlo pasar produce
    // una configuración que aparenta estar puesta y no hace nada.
    if (datos.retentionPurgeEnabled) {
      const actual = await this.getRetention(companyId);
      const plazo = datos.retentionMonths ?? actual.retentionMonths;
      if (!plazo) {
        throw new BadRequestException(
          'Define primero cuántos meses se conservan antes de activar la purga.',
        );
      }
    }

    const actualizada = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(datos.retentionMonths !== undefined
          ? { retentionMonths: datos.retentionMonths }
          : {}),
        ...(datos.retentionPurgeEnabled !== undefined
          ? { retentionPurgeEnabled: datos.retentionPurgeEnabled }
          : {}),
      },
      select: { retentionMonths: true, retentionPurgeEnabled: true },
    });

    // Cambiar la política de retención se audita siempre: es la decisión que
    // explica, meses después, por qué faltan datos.
    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: companyId,
      action: 'RETENTION_POLICY_CHANGED',
      entityType: 'Company',
      entityId: companyId,
      metadata: actualizada,
    });

    return actualizada;
  }

  // ── exportación ─────────────────────────────────────────────

  /**
   * Copia de los datos de la empresa.
   *
   * Se sirve completa y en memoria: una empresa del tamaño que maneja este
   * producto cabe de sobra, y un flujo obligaría a decidir qué hacer si falla
   * a mitad, con medio fichero ya entregado.
   *
   * NO incluye credenciales de ningún tipo. El token de WhatsApp está cifrado
   * en la base y aquí ni siquiera se selecciona: exportar un secreto cifrado
   * sigue siendo exportar un secreto.
   */
  async exportCompanyData(companyId: string, actor: { userId: string; role: string }) {
    const [empresa, contactos, conversaciones, oportunidades, tareas, cotizaciones] =
      await Promise.all([
        this.prisma.company.findUnique({
          where: { id: companyId },
          select: {
            id: true,
            name: true,
            legalName: true,
            taxId: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            country: true,
            createdAt: true,
          },
        }),
        this.prisma.contact.findMany({
          where: { companyId },
          select: { id: true, name: true, phone: true, email: true, createdAt: true },
        }),
        this.prisma.conversation.findMany({
          where: { companyId },
          select: {
            id: true,
            status: true,
            channel: true,
            createdAt: true,
            lastMessageAt: true,
            contactId: true,
            messages: {
              select: {
                id: true,
                body: true,
                direction: true,
                type: true,
                status: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        this.prisma.lead.findMany({
          where: { companyId },
          select: {
            id: true,
            title: true,
            value: true,
            status: true,
            createdAt: true,
            contactId: true,
          },
        }),
        this.prisma.task.findMany({
          where: { companyId },
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            createdAt: true,
          },
        }),
        this.prisma.quote.findMany({
          where: { companyId },
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            createdAt: true,
            items: { select: { name: true, quantity: true, unitPrice: true } },
          },
        }),
      ]);

    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: companyId,
      action: 'DATA_EXPORTED',
      entityType: 'Company',
      entityId: companyId,
      metadata: {
        contactos: contactos.length,
        conversaciones: conversaciones.length,
        oportunidades: oportunidades.length,
      },
    });

    return {
      generadoEl: new Date().toISOString(),
      empresa,
      contactos,
      conversaciones,
      oportunidades,
      tareas,
      cotizaciones,
    };
  }

  // ── solicitudes ─────────────────────────────────────────────

  async requestDeletion(
    companyId: string,
    reason: string,
    actor: { userId: string; role: string },
  ) {
    if (!reason?.trim() || reason.trim().length < 10) {
      // Una solicitud sin motivo no se puede revisar ni defender después.
      throw new BadRequestException(
        'Explica el motivo de la eliminación (mínimo 10 caracteres).',
      );
    }

    const solicitud = await this.prisma.dataRequest.create({
      data: {
        companyId,
        type: 'DELETION',
        reason: reason.trim(),
        requestedBy: actor.userId ?? null,
      },
    });

    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: companyId,
      action: 'DELETION_REQUESTED',
      entityType: 'DataRequest',
      entityId: solicitud.id,
      reason: reason.trim(),
    });

    return solicitud;
  }

  async listRequests(companyId: string) {
    return this.prisma.dataRequest.findMany({
      where: { companyId },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
  }

  // ── purga ───────────────────────────────────────────────────

  /**
   * Qué se purgaría, SIN purgar nada.
   *
   * Existe porque nadie debería activar una purga sin ver antes el número.
   * «Se borrarán 12.400 mensajes» es una frase que cambia decisiones.
   */
  async previewPurge(companyId: string) {
    const empresa = await this.getRetention(companyId);
    if (!empresa.retentionMonths) {
      return { aplicable: false, motivo: 'sin-politica' as const, mensajes: 0 };
    }

    const corte = this.fechaDeCorte(empresa.retentionMonths);
    const mensajes = await this.prisma.message.count({
      where: {
        createdAt: { lt: corte },
        conversation: {
          companyId,
          status: { in: ['CLOSED', 'ARCHIVED'] },
        },
      },
    });

    return {
      aplicable: true,
      corte,
      purgaActivada: empresa.retentionPurgeEnabled,
      mensajes,
    };
  }

  /**
   * Purga real. Exige las DOS señales y solo toca conversaciones cerradas o
   * archivadas: una conversación abierta es trabajo en curso, por antigua que
   * sea su fecha de creación.
   */
  async purge(companyId: string, actor: { userId: string; role: string }) {
    const empresa = await this.getRetention(companyId);

    if (!empresa.retentionMonths || !empresa.retentionPurgeEnabled) {
      throw new BadRequestException(
        'La purga requiere un plazo de retención definido y activado explícitamente.',
      );
    }

    const corte = this.fechaDeCorte(empresa.retentionMonths);

    const { count } = await this.prisma.message.deleteMany({
      where: {
        createdAt: { lt: corte },
        conversation: {
          companyId,
          status: { in: ['CLOSED', 'ARCHIVED'] },
        },
      },
    });

    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: companyId,
      action: 'DATA_PURGED',
      entityType: 'Company',
      entityId: companyId,
      metadata: { mensajesEliminados: count, corte: corte.toISOString() },
    });

    this.logger.log(`Purga de retención: ${count} mensajes eliminados`);
    return { mensajesEliminados: count, corte };
  }

  private fechaDeCorte(meses: number): Date {
    const corte = new Date();
    corte.setMonth(corte.getMonth() - meses);
    return corte;
  }
}


