import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import { resta, suma } from '../../common/dinero/dinero';
import { PrismaService } from '../../prisma/prisma.service';
import { calcularCotizacion } from './quote-calculo';

const LEAD_SELECT = { id: true, title: true, status: true };

// Curated fiscal/identity fields of the quote's OWNING company, so the
// printable document renders the company that owns the quote (resolved
// server-side, isolated by companyId) rather than the viewer's company or a
// hardcoded footer. Never selects secrets — Company has none, but we still
// list fields explicitly instead of returning the whole row.
const COMPANY_IDENTITY_SELECT = {
  id: true,
  name: true,
  legalName: true,
  taxId: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  country: true,
  website: true,
  logoUrl: true,
  quoteFooter: true,
} as const;

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: { leadId?: string; status?: string },
  ) {
    return this.prisma.quote.findMany({
      where: {
        companyId,
        ...(filters.leadId && { leadId: filters.leadId }),
        ...(filters.status && { status: filters.status as QuoteStatus }),
      },
      include: { lead: { select: LEAD_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Todo lo que el PDF necesita, resuelto en una consulta y acotado por
   * empresa. El contacto viene del lead: es a quien se dirige el documento,
   * y sin el la cotizacion sale con el titulo de la oportunidad como
   * destinatario, que es un apano y se nota.
   */
  async findForPdf(id: string, companyId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        company: {
          select: {
            ...COMPANY_IDENTITY_SELECT,
            currency: true,
            locale: true,
          },
        },
        lead: {
          select: {
            title: true,
            contact: { select: { name: true, phone: true } },
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    return quote;
  }

  async findById(id: string, companyId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId },
      include: {
        lead: { select: LEAD_SELECT },
        items: { orderBy: { createdAt: 'asc' } },
        company: { select: COMPANY_IDENTITY_SELECT },
      },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    return quote;
  }

  async createFromLead(
    leadId: string,
    companyId: string,
    userId: string | undefined,
    data: {
      title?: string;
      notes?: string;
      validUntil?: string;
      discount?: number;
      shipping?: number;
      adjustment?: number;
      taxRate?: number;
      taxIncluded?: boolean;
    },
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');

    const leadProducts = await this.prisma.leadProduct.findMany({
      where: { leadId },
      include: {
        product: {
          select: { id: true, name: true, description: true, category: true },
        },
      },
    });
    if (leadProducts.length === 0) {
      throw new BadRequestException(
        'El lead no tiene productos asociados para generar una cotización',
      );
    }

    // La empresa decide cómo se redondea y cómo se cobra el impuesto; la
    // cotización se lleva esos valores CONGELADOS, para que cambiar el ajuste
    // de la empresa mañana no recalcule en silencio un documento ya enviado.
    const empresa = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        currency: true,
        quoteRoundingDecimals: true,
        defaultTaxRate: true,
        taxIncluded: true,
      },
    });

    const taxRate = data.taxRate ?? empresa.defaultTaxRate;
    const taxIncluded = data.taxIncluded ?? empresa.taxIncluded;
    const roundingDecimals = empresa.quoteRoundingDecimals;

    const calculo = calcularCotizacion({
      lineas: leadProducts.map((lp) => ({
        quantity: lp.quantity,
        unitPrice: lp.unitPrice,
      })),
      discount: data.discount ?? 0,
      shipping: data.shipping ?? 0,
      adjustment: data.adjustment ?? 0,
      taxRate,
      taxIncluded,
      roundingDecimals,
    });

    const itemsData = leadProducts.map((lp, i) => ({
      productId: lp.productId,
      name: lp.product.name,
      description: lp.product.description,
      category: lp.product.category,
      quantity: lp.quantity,
      unitPrice: lp.unitPrice,
      lineDiscount: calculo.lineas[i].descuento,
      subtotal: calculo.lineas[i].subtotal,
      notes: lp.notes,
    }));

    const { subtotal, discount, total } = {
      subtotal: calculo.subtotal,
      discount: calculo.discount,
      total: calculo.total,
    };
    const number = await this.generateNextNumber(companyId);

    try {
      return await this.prisma.quote.create({
        data: {
          number,
          title: data.title,
          notes: data.notes,
          validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
          subtotal,
          discount,
          total,
          lineDiscountTotal: calculo.lineDiscountTotal,
          shipping: calculo.shipping,
          adjustment: calculo.adjustment,
          taxRate,
          taxTotal: calculo.taxTotal,
          taxIncluded,
          currency: empresa.currency,
          roundingDecimals,
          companyId,
          leadId,
          createdById: userId,
          items: { create: itemsData },
        },
        include: {
          lead: { select: LEAD_SELECT },
          items: { orderBy: { createdAt: 'asc' } },
        },
      });
    } catch (error) {
      // companyId+number is unique — a concurrent request could in theory
      // compute the same next number for the same company at the same time.
      // Surface that as a clean, retryable 409 instead of a raw 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'No se pudo generar el número de la cotización, intenta de nuevo',
        );
      }
      throw error;
    }
  }

  /**
   * Recalcula la cotizacion entera con el SERVIDOR como autoridad.
   *
   * Antes solo se recalculaba el descuento general: transporte, impuesto y
   * ajuste se guardaban tal cual —cuando el DTO los hubiera dejado pasar, que
   * no era el caso— y el total quedaba desalineado con sus propias partes.
   *
   * El total NUNCA llega del cliente. Se vuelve a calcular desde las lineas
   * PERSISTIDAS y los parametros vigentes, de modo que quien manipule el cuerpo
   * de la peticion no puede imponer un total distinto del que sale de las
   * cuentas.
   */
  async update(
    id: string,
    companyId: string,
    data: {
      title?: string;
      status?: QuoteStatus;
      notes?: string;
      validUntil?: string;
      discount?: number;
      shipping?: number;
      adjustment?: number;
      adjustmentLabel?: string;
      taxRate?: number;
      taxIncluded?: boolean;
      lineas?: Array<{
        id: string;
        quantity?: number;
        unitPrice?: number;
        lineDiscount?: number;
        lineDiscountPercent?: number;
      }>;
    },
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');

    const tocaLaEconomia =
      (data.lineas !== undefined && data.lineas.length > 0) ||
      data.discount !== undefined ||
      data.shipping !== undefined ||
      data.adjustment !== undefined ||
      data.taxRate !== undefined ||
      data.taxIncluded !== undefined;

    // Una cotizacion ya enviada es un documento que alguien tiene en la mano.
    // Cambiarle los numeros por debajo la convierte en otra cosa con el mismo
    // numero; para eso existe `POST /quotes/:id/revision`, que crea una nueva.
    if (tocaLaEconomia && quote.status !== 'DRAFT') {
      throw new ConflictException(
        'Esta cotización ya no es un borrador. Crea una revisión para cambiar sus importes.',
      );
    }

    // Los cambios de linea se aplican SOBRE lo persistido, no lo sustituyen:
    // enviar solo `lineDiscount` de una linea no puede borrar su cantidad.
    //
    // Una linea que no pertenece a esta cotizacion se rechaza en vez de
    // ignorarse en silencio: ignorarla devolveria un 200 y un total que no es
    // el que quien la mando esperaba.
    const cambiosPorLinea = new Map((data.lineas ?? []).map((l) => [l.id, l]));
    for (const clave of cambiosPorLinea.keys()) {
      if (!quote.items.some((i) => i.id === clave)) {
        throw new BadRequestException(
          'Una de las líneas enviadas no pertenece a esta cotización.',
        );
      }
    }

    const lineasFinales = quote.items.map((i) => {
      const cambio = cambiosPorLinea.get(i.id);
      return {
        id: i.id,
        quantity: cambio?.quantity ?? i.quantity,
        unitPrice: cambio?.unitPrice ?? i.unitPrice,
        lineDiscount: cambio?.lineDiscount ?? i.lineDiscount,
        lineDiscountPercent:
          cambio?.lineDiscountPercent ?? i.lineDiscountPercent,
      };
    });

    const calculo = calcularCotizacion({
      lineas: lineasFinales.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineDiscount: l.lineDiscount,
        lineDiscountPercent: l.lineDiscountPercent,
      })),
      discount: data.discount ?? quote.discount,
      shipping: data.shipping ?? quote.shipping,
      adjustment: data.adjustment ?? quote.adjustment,
      taxRate: data.taxRate ?? quote.taxRate,
      taxIncluded: data.taxIncluded ?? quote.taxIncluded,
      roundingDecimals: quote.roundingDecimals,
    });

    // UN AJUSTE QUE SE COME EL DOCUMENTO SE RECHAZA, NO SE RECORTA.
    //
    // El motor acota la base a cero —`noNegativo`— para que ningun total salga
    // negativo. Eso esta bien como ultima red, pero convierte un ajuste de
    // -500.000 sobre una cotizacion de 100.000 en un total de 0 sin decir nada,
    // y quien lo escribio casi siempre puso el signo al reves.
    //
    // Por eso se mira la base ANTES del recorte: si es negativa, es un 400 con
    // un mensaje, no un documento que cobra cero.
    const baseAntesDelRecorte = suma(
      resta(calculo.subtotal, calculo.discount),
      calculo.shipping,
      calculo.adjustment,
    );
    if (baseAntesDelRecorte.isNegative()) {
      throw new BadRequestException(
        'El ajuste deja el total por debajo de cero. Revisa su signo o su importe.',
      );
    }

    // Las lineas y la cabecera se guardan en UNA transaccion: un total que no
    // cuadre con sus lineas es peor que no haber guardado nada.
    await this.prisma.$transaction(
      lineasFinales.map((l, i) =>
        this.prisma.quoteItem.update({
          where: { id: l.id },
          data: {
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineDiscount: calculo.lineas[i].descuento,
            lineDiscountPercent: l.lineDiscountPercent,
            subtotal: calculo.lineas[i].subtotal,
          },
        }),
      ),
    );

    return this.prisma.quote.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.adjustmentLabel !== undefined
          ? { adjustmentLabel: data.adjustmentLabel }
          : {}),
        ...(data.validUntil !== undefined
          ? { validUntil: new Date(data.validUntil) }
          : {}),
        ...(data.taxIncluded !== undefined
          ? { taxIncluded: data.taxIncluded }
          : {}),
        subtotal: calculo.subtotal,
        lineDiscountTotal: calculo.lineDiscountTotal,
        discount: calculo.discount,
        shipping: calculo.shipping,
        adjustment: calculo.adjustment,
        taxRate: data.taxRate ?? quote.taxRate,
        taxTotal: calculo.taxTotal,
        total: calculo.total,
      },
      include: {
        lead: { select: LEAD_SELECT },
        items: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async remove(id: string, companyId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');

    if (quote.status === 'ACCEPTED') {
      throw new BadRequestException(
        'No se puede eliminar una cotización aceptada',
      );
    }

    await this.prisma.quote.delete({ where: { id } });
    return { id };
  }

  /**
   * Siguiente numero de cotizacion.
   *
   * Antes se traian TODAS las cotizaciones de la empresa a memoria solo para
   * quedarse con el maximo: con mil cotizaciones son mil filas por cada
   * documento nuevo, y crece para siempre. Ahora el maximo lo calcula la base
   * y vuelve un unico entero.
   *
   * Sigue habiendo carrera —dos peticiones simultaneas pueden leer el mismo
   * maximo— y por eso NO se confia en esto para la unicidad: el indice unico
   * `(companyId, number)` es quien la garantiza, y `createFromLead` traduce su
   * violacion en un 409 que se puede reintentar.
   */
  private async generateNextNumber(companyId: string): Promise<string> {
    const filas = await this.prisma.$queryRaw<Array<{ maximo: number | null }>>`
      SELECT MAX(NULLIF(regexp_replace("number", '^.*?(\\d+)$', '\\1'), "number")::bigint) AS maximo
      FROM "quotes"
      WHERE "companyId" = ${companyId}
    `;

    const max = Number(filas[0]?.maximo ?? 0);
    return `COT-${String(max + 1).padStart(4, '0')}`;
  }
}
