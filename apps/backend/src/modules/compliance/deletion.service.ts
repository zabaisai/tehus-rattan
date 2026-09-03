import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

export interface ActorPlataforma {
  userId: string;
  role: string;
}

/** Qué se borró, por tabla. Se guarda en la solicitud como prueba. */
export interface ResumenEliminacion {
  mensajes: number;
  conversaciones: number;
  oportunidades: number;
  tareas: number;
  cotizaciones: number;
  contactos: number;
  automatizaciones: number;
  flujosChatbot: number;
}

/**
 * Aprobación y ejecución de solicitudes de eliminación.
 *
 * ESTO BORRA DATOS DE FORMA IRREVERSIBLE. Todo el diseño está puesto para que
 * no ocurra por accidente ni por una sola persona:
 *
 * 1. **Tres papeles separados**: quien pide, quien aprueba y quien ejecuta.
 *    Aprobar la propia solicitud está prohibido — no por desconfianza, sino
 *    porque una segunda persona es la única forma de detectar un error de
 *    quien la escribió.
 *
 * 2. **Solo SUPER_ADMIN de plataforma aprueba y ejecuta.** Un ADMIN puede
 *    pedir la eliminación de SU empresa; no puede consumarla. Si pudiera, un
 *    ADMIN comprometido borraría el historial de su propia empresa sin que
 *    nadie más interviniera.
 *
 * 3. **Doble confirmación**: aprobar es un paso, ejecutar es otro, y ejecutar
 *    exige teclear el nombre exacto de la empresa. Un botón de confirmación
 *    se pulsa por inercia; escribir «Empresa Ejemplo S.A.S.» a mano, no.
 *
 * 4. **La empresa NO se borra.** Se borran sus datos operativos y queda la
 *    ficha con el rastro de auditoría. Borrar la fila de la empresa se
 *    llevaría por delante la auditoría de su propio borrado.
 */
@Injectable()
export class DeletionService {
  private readonly logger = new Logger(DeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditLogService,
  ) {}

  /** Solicitudes de todas las empresas, para el panel de plataforma. */
  async listAll(status?: string) {
    return this.prisma.dataRequest.findMany({
      where: {
        type: 'DELETION',
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: 100,
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async approve(id: string, actor: ActorPlataforma) {
    const solicitud = await this.buscar(id);

    if (solicitud.status !== 'PENDING') {
      throw new BadRequestException(
        `La solicitud ya está en estado ${solicitud.status}.`,
      );
    }

    // Cuatro ojos. Es la comprobación que convierte esto en un proceso y no
    // en un botón.
    if (solicitud.requestedBy && solicitud.requestedBy === actor.userId) {
      throw new ForbiddenException(
        'Quien solicita una eliminación no puede aprobarla: hace falta una segunda persona.',
      );
    }

    const aprobada = await this.prisma.dataRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: actor.userId },
    });

    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: solicitud.companyId,
      action: 'DELETION_APPROVED',
      entityType: 'DataRequest',
      entityId: id,
      reason: solicitud.reason,
    });

    return aprobada;
  }

  async reject(id: string, motivo: string, actor: ActorPlataforma) {
    const solicitud = await this.buscar(id);

    if (solicitud.status !== 'PENDING') {
      throw new BadRequestException(
        `La solicitud ya está en estado ${solicitud.status}.`,
      );
    }
    if (!motivo?.trim() || motivo.trim().length < 10) {
      // Rechazar sin explicar deja a quien lo pidió sin saber qué corregir.
      throw new BadRequestException(
        'Explica por qué se rechaza (mínimo 10 caracteres).',
      );
    }

    const rechazada = await this.prisma.dataRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedBy: actor.userId,
        rejectionReason: motivo.trim(),
        resolvedAt: new Date(),
      },
    });

    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: solicitud.companyId,
      action: 'DELETION_REJECTED',
      entityType: 'DataRequest',
      entityId: id,
      reason: motivo.trim(),
    });

    return rechazada;
  }

  /**
   * Qué se borraría si se ejecutara. Sin borrar nada.
   *
   * Se ofrece incluso estando ya aprobada: quien ejecuta debe ver el número
   * antes de teclear el nombre de la empresa.
   */
  async preview(id: string) {
    const solicitud = await this.buscar(id);
    const resumen = await this.contar(solicitud.companyId);
    return {
      empresa: solicitud.company,
      status: solicitud.status,
      resumen,
    };
  }

  /**
   * Ejecuta la eliminación. Punto sin retorno.
   *
   * Exige: solicitud APROBADA, ejecutor distinto de quien aprobó, y el nombre
   * exacto de la empresa escrito a mano.
   */
  async execute(
    id: string,
    confirmacion: string,
    actor: ActorPlataforma,
  ): Promise<{ resumen: ResumenEliminacion }> {
    const solicitud = await this.buscar(id);

    if (solicitud.status !== 'APPROVED') {
      throw new BadRequestException(
        'Solo se puede ejecutar una solicitud aprobada.',
      );
    }

    // Aprobar y ejecutar tampoco pueden ser la misma persona: si lo fueran,
    // la aprobación sería un trámite que se firma a sí mismo.
    if (solicitud.approvedBy && solicitud.approvedBy === actor.userId) {
      throw new ForbiddenException(
        'Quien aprueba una eliminación no puede ejecutarla: hace falta una tercera comprobación.',
      );
    }

    const nombre = solicitud.company.name.trim();
    if (confirmacion?.trim() !== nombre) {
      // Un botón se pulsa por inercia; escribir el nombre completo, no.
      throw new BadRequestException(
        'Escribe el nombre exacto de la empresa para confirmar la eliminación.',
      );
    }

    const resumen = await this.borrar(solicitud.companyId);

    await this.prisma.dataRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        executedBy: actor.userId,
        confirmationText: nombre,
        resolvedAt: new Date(),
        result: resumen as unknown as never,
      },
    });

    // La auditoría se escribe DESPUÉS del borrado y sobrevive a él: la fila
    // de la empresa no se elimina precisamente para que este rastro tenga
    // dónde apuntar.
    await this.audit.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role as never,
      affectedCompanyId: solicitud.companyId,
      action: 'DELETION_EXECUTED',
      entityType: 'DataRequest',
      entityId: id,
      reason: solicitud.reason,
      metadata: resumen as unknown as never,
    });

    this.logger.warn(
      `Eliminación ejecutada para la empresa ${solicitud.companyId}: ${JSON.stringify(resumen)}`,
    );

    return { resumen };
  }

  // ── internos ────────────────────────────────────────────────

  private async buscar(id: string) {
    const solicitud = await this.prisma.dataRequest.findFirst({
      where: { id, type: 'DELETION' },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    return solicitud;
  }

  private async contar(companyId: string): Promise<ResumenEliminacion> {
    const [
      mensajes,
      conversaciones,
      oportunidades,
      tareas,
      cotizaciones,
      contactos,
      automatizaciones,
      flujosChatbot,
    ] = await Promise.all([
      this.prisma.message.count({ where: { conversation: { companyId } } }),
      this.prisma.conversation.count({ where: { companyId } }),
      this.prisma.lead.count({ where: { companyId } }),
      this.prisma.task.count({ where: { companyId } }),
      this.prisma.quote.count({ where: { companyId } }),
      this.prisma.contact.count({ where: { companyId } }),
      this.prisma.automation.count({ where: { companyId } }),
      this.prisma.chatbotFlow.count({ where: { companyId } }),
    ]);

    return {
      mensajes,
      conversaciones,
      oportunidades,
      tareas,
      cotizaciones,
      contactos,
      automatizaciones,
      flujosChatbot,
    };
  }

  /**
   * Borra los datos operativos de UNA empresa.
   *
   * En una transacción: un borrado a medias dejaría la empresa en un estado
   * imposible —conversaciones sin contacto, cotizaciones sin oportunidad—
   * peor que antes de empezar.
   *
   * El orden respeta las claves foráneas, de las hojas hacia la raíz. Cada
   * `deleteMany` lleva su `companyId`: repetirlo es redundante con el filtro
   * de la relación, y es a propósito — si alguien reordena el código, la
   * consulta sigue sin poder tocar otra empresa.
   */
  private async borrar(companyId: string): Promise<ResumenEliminacion> {
    const resumen = await this.contar(companyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.chatbotSession.deleteMany({ where: { companyId } });
      await tx.chatbotFlowVersion.deleteMany({
        where: { flow: { companyId } },
      });
      await tx.chatbotFlow.deleteMany({ where: { companyId } });

      await tx.automationRun.deleteMany({ where: { companyId } });
      await tx.automationVersion.deleteMany({
        where: { automation: { companyId } },
      });
      await tx.automation.deleteMany({ where: { companyId } });

      await tx.outboxEvent.deleteMany({ where: { companyId } });
      await tx.notification.deleteMany({ where: { companyId } });

      await tx.quoteItem.deleteMany({ where: { quote: { companyId } } });
      await tx.quote.deleteMany({ where: { companyId } });

      await tx.conversationRead.deleteMany({
        where: { conversation: { companyId } },
      });
      await tx.message.deleteMany({ where: { conversation: { companyId } } });
      await tx.note.deleteMany({ where: { companyId } });
      await tx.task.deleteMany({ where: { companyId } });
      await tx.conversation.deleteMany({ where: { companyId } });

      await tx.leadStageHistory.deleteMany({ where: { lead: { companyId } } });
      await tx.leadProduct.deleteMany({ where: { lead: { companyId } } });
      await tx.lead.deleteMany({ where: { companyId } });

      await tx.contact.deleteMany({ where: { companyId } });
      await tx.product.deleteMany({ where: { companyId } });
      await tx.pipelineStage.deleteMany({
        where: { pipeline: { companyId } },
      });
      await tx.pipeline.deleteMany({ where: { companyId } });

      // La integración de WhatsApp incluye el token cifrado: se va con el
      // resto. La empresa y sus usuarios NO se borran — la ficha queda para
      // que la auditoría de este borrado tenga a dónde apuntar.
      await tx.whatsAppIntegration.deleteMany({ where: { companyId } });
    });

    return resumen;
  }
}
