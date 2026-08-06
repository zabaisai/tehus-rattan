import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ciclo de vida de una cotizacion: enviar, revisar, aceptar, rechazar,
 * caducar y cancelar.
 *
 * Vive aparte del CRUD porque son transiciones, no ediciones: cada una tiene
 * su regla sobre desde que estado se puede llegar, y mezclarlas con `update`
 * convertiria ese metodo en un arbol de condiciones que nadie se atreve a
 * tocar.
 */
@Injectable()
export class QuoteCicloService {
  constructor(private prisma: PrismaService) {}

  /**
   * Marca la cotizacion como ENVIADA.
   *
   * IDEMPOTENTE por `sendIdempotencyKey`: reintentar un envio —porque la red
   * fallo, porque alguien pulso dos veces— no puede mandarle al cliente la
   * misma cotizacion dos veces.
   *
   * Esto NO manda nada por si mismo: registra que se envio y mueve la
   * oportunidad. El envio real lo hace quien corresponda, y en pruebas
   * WhatsApp sigue en dry-run.
   */
  async enviar(
    id: string,
    companyId: string,
    idempotencyKey: string,
  ): Promise<{
    cotizacion: { id: string; status: QuoteStatus; sentAt: Date | null };
    yaEstabaEnviada: boolean;
    oportunidadMovida: boolean;
    avisoDeConfiguracion: string | null;
  }> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'Falta la clave de idempotencia del envío.',
      );
    }

    const existente = await this.prisma.quote.findUnique({
      where: { sendIdempotencyKey: idempotencyKey },
      select: { id: true, status: true, sentAt: true, companyId: true },
    });
    if (existente) {
      if (existente.companyId !== companyId || existente.id !== id) {
        throw new ConflictException(
          'Esa clave de envío ya se usó para otra cotización.',
        );
      }
      // Mismo envío, otra vez. Se devuelve lo que ya pasó.
      return {
        cotizacion: existente,
        yaEstabaEnviada: true,
        oportunidadMovida: false,
        avisoDeConfiguracion: null,
      };
    }

    const cotizacion = await this.prisma.quote.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, leadId: true },
    });
    if (!cotizacion) throw new NotFoundException('Cotización no encontrada');

    if (cotizacion.status === 'ACCEPTED') {
      throw new BadRequestException(
        'Esta cotización ya fue aceptada; no se vuelve a enviar. Crea una revisión si necesitas cambiarla.',
      );
    }
    if (cotizacion.status === 'REJECTED') {
      throw new BadRequestException(
        'Esta cotización fue rechazada. Crea una revisión en vez de reenviarla.',
      );
    }

    const actualizada = await this.prisma.quote.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sendIdempotencyKey: idempotencyKey,
      },
      select: { id: true, status: true, sentAt: true },
    });

    const movimiento = await this.moverOportunidadAlEmbudoDeCotizaciones(
      companyId,
      cotizacion.leadId,
    );

    return {
      cotizacion: actualizada,
      yaEstabaEnviada: false,
      ...movimiento,
    };
  }

  /**
   * Mueve la oportunidad al embudo y la etapa CONFIGURADOS.
   *
   * POR ID Y NUNCA POR NOMBRE. Buscar un embudo llamado «Cotizaciones» rompe
   * el dia que alguien lo renombra, y renombrarlo es algo que puede hacer
   * cualquiera cualquier dia.
   *
   * Si no hay configuracion, NO se adivina: se devuelve un aviso que dice
   * donde ponerla. Mover la oportunidad a un sitio elegido por el sistema es
   * peor que no moverla, porque nadie sabe por que se movio.
   */
  private async moverOportunidadAlEmbudoDeCotizaciones(
    companyId: string,
    leadId: string,
  ): Promise<{
    oportunidadMovida: boolean;
    avisoDeConfiguracion: string | null;
  }> {
    const cfg = await this.prisma.companyLeadSettings.findUnique({
      where: { companyId },
      select: { quotePipelineId: true, quoteStageId: true },
    });

    if (!cfg?.quotePipelineId || !cfg?.quoteStageId) {
      return {
        oportunidadMovida: false,
        avisoDeConfiguracion:
          'La cotización se envió, pero la oportunidad no se movió: falta configurar el embudo y la etapa de cotizaciones en Ajustes › Oportunidades.',
      };
    }

    // La etapa tiene que pertenecer al embudo Y el embudo a la empresa: sin
    // esto, una configuración vieja movería oportunidades a un embudo ajeno.
    const etapa = await this.prisma.pipelineStage.findFirst({
      where: {
        id: cfg.quoteStageId,
        pipelineId: cfg.quotePipelineId,
        pipeline: { companyId },
      },
      select: { id: true },
    });
    if (!etapa) {
      return {
        oportunidadMovida: false,
        avisoDeConfiguracion:
          'La cotización se envió, pero el embudo de cotizaciones configurado ya no es válido. Revísalo en Ajustes › Oportunidades.',
      };
    }

    const movidas = await this.prisma.lead.updateMany({
      // Solo si NO está ya ahí: repetir el movimiento ensuciaría el historial
      // de etapas con entradas que no significan nada.
      where: {
        id: leadId,
        companyId,
        NOT: { stageId: cfg.quoteStageId },
      },
      data: {
        pipelineId: cfg.quotePipelineId,
        stageId: cfg.quoteStageId,
      },
    });

    if (movidas.count > 0) {
      await this.prisma.leadStageHistory.create({
        data: { leadId, toStageId: cfg.quoteStageId },
      });
    }

    return { oportunidadMovida: movidas.count > 0, avisoDeConfiguracion: null };
  }

  /**
   * Crea una REVISION.
   *
   * Una cotizacion enviada no se edita: se revisa. Editar el documento que el
   * cliente ya tiene en la mano hace que dos personas miren cifras distintas
   * creyendo que miran la misma cotizacion.
   *
   * La revision nace en BORRADOR, copia las lineas y apunta a la anterior.
   */
  async crearRevision(id: string, companyId: string, userId?: string) {
    const original = await this.prisma.quote.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!original) throw new NotFoundException('Cotización no encontrada');

    return this.prisma.$transaction(async (tx) => {
      const revision = await tx.quote.create({
        data: {
          companyId,
          leadId: original.leadId,
          contactId: original.contactId,
          conversationId: original.conversationId,
          // El número conserva la raíz y sube la revisión: `COT-0007 r2` dice
          // de un vistazo que es la misma negociación.
          number: `${original.number.replace(/ r\d+$/, '')} r${original.revision + 1}`,
          title: original.title,
          notes: original.notes,
          terms: original.terms,
          validUntil: original.validUntil,
          subtotal: original.subtotal,
          discount: original.discount,
          lineDiscountTotal: original.lineDiscountTotal,
          adjustment: original.adjustment,
          adjustmentLabel: original.adjustmentLabel,
          shipping: original.shipping,
          taxRate: original.taxRate,
          taxTotal: original.taxTotal,
          taxIncluded: original.taxIncluded,
          currency: original.currency,
          roundingDecimals: original.roundingDecimals,
          total: original.total,
          assignedTo: original.assignedTo,
          createdById: userId,
          revision: original.revision + 1,
          parentQuoteId: original.id,
          status: 'DRAFT',
          items: {
            create: original.items.map((i) => ({
              productId: i.productId,
              name: i.name,
              description: i.description,
              category: i.category,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              lineDiscount: i.lineDiscount,
              lineDiscountPercent: i.lineDiscountPercent,
              subtotal: i.subtotal,
              notes: i.notes,
            })),
          },
        },
        include: { items: true },
      });

      return revision;
    });
  }

  /** El cliente la aceptó. */
  async aceptar(id: string, companyId: string) {
    return this.transicion(id, companyId, {
      desde: ['SENT'],
      a: 'ACCEPTED',
      datos: { acceptedAt: new Date() },
      error:
        'Solo se puede aceptar una cotización que se haya enviado. Envíala primero.',
    });
  }

  async rechazar(id: string, companyId: string, motivo?: string) {
    return this.transicion(id, companyId, {
      desde: ['SENT'],
      a: 'REJECTED',
      datos: {
        rejectedAt: new Date(),
        rejectionReason: motivo?.trim() || null,
      },
      error: 'Solo se puede rechazar una cotización que se haya enviado.',
    });
  }

  /** Retirarla antes de que el cliente responda. */
  async cancelar(id: string, companyId: string, motivo?: string) {
    return this.transicion(id, companyId, {
      desde: ['DRAFT', 'SENT'],
      a: 'EXPIRED',
      datos: {
        cancelledAt: new Date(),
        rejectionReason: motivo?.trim() || null,
      },
      error: 'Esta cotización ya no se puede cancelar.',
    });
  }

  /**
   * Caduca las que pasaron su fecha de vigencia.
   *
   * Una cotizacion vencida que sigue diciendo «enviada» hace que alguien la dé
   * por viva y honre un precio de hace tres meses.
   */
  async caducarVencidas(
    companyId: string,
    ahora = new Date(),
  ): Promise<{ caducadas: number }> {
    const r = await this.prisma.quote.updateMany({
      where: {
        companyId,
        status: 'SENT',
        validUntil: { not: null, lt: ahora },
      },
      data: { status: 'EXPIRED' },
    });
    return { caducadas: r.count };
  }

  private async transicion(
    id: string,
    companyId: string,
    regla: {
      desde: QuoteStatus[];
      a: QuoteStatus;
      datos: Prisma.QuoteUpdateManyMutationInput;
      error: string;
    },
  ) {
    const actual = await this.prisma.quote.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!actual) throw new NotFoundException('Cotización no encontrada');

    const cambiadas = await this.prisma.quote.updateMany({
      where: { id, companyId, status: { in: regla.desde } },
      data: { ...regla.datos, status: regla.a },
    });

    if (cambiadas.count === 0) throw new ConflictException(regla.error);

    return this.prisma.quote.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        status: true,
        acceptedAt: true,
        rejectedAt: true,
        cancelledAt: true,
      },
    });
  }
}
