import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import {
  type Dinero,
  dinero,
  suma,
  resta,
  multiplica,
  redondea,
  noNegativo,
  mayorQue,
} from '../../common/dinero/dinero';
import { PrismaService } from '../../prisma/prisma.service';

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

/**
 * El calculo del dinero vive en el SERVIDOR y en Decimal.
 *
 * El navegador puede calcular para que el usuario vea el total al instante,
 * pero lo que se guarda es esto: si las dos cifras discrepan, manda esta. Un
 * total que llega del cliente es un total que el cliente puede cambiar.
 */
function calcularTotales(
  lineas: Array<{ quantity: number; unitPrice: Prisma.Decimal.Value }>,
  descuentoGeneral: Prisma.Decimal.Value,
): { subtotal: Dinero; descuento: Dinero; total: Dinero } {
  const subtotal = redondea(
    suma(...lineas.map((l) => multiplica(l.quantity, l.unitPrice))),
  );
  // El descuento no puede superar al subtotal: un total negativo no es un
  // cobro, es un error de captura.
  const descuento = redondea(
    mayorQue(descuentoGeneral, subtotal) ? subtotal : dinero(descuentoGeneral),
  );
  return { subtotal, descuento, total: redondea(resta(subtotal, descuento)) };
}

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

    const itemsData = leadProducts.map((lp) => ({
      productId: lp.productId,
      name: lp.product.name,
      description: lp.product.description,
      category: lp.product.category,
      quantity: lp.quantity,
      unitPrice: lp.unitPrice,
      subtotal: redondea(multiplica(lp.quantity, lp.unitPrice)),
      notes: lp.notes,
    }));

    const { subtotal, descuento, total } = calcularTotales(
      leadProducts,
      data.discount ?? 0,
    );
    const discount = descuento;
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

  async update(
    id: string,
    companyId: string,
    data: {
      title?: string;
      status?: QuoteStatus;
      notes?: string;
      validUntil?: string;
      discount?: number;
    },
  ) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId },
      select: { id: true, subtotal: true, discount: true },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');

    // El descuento nunca puede dejar el total por debajo de cero, y se acota
    // al subtotal en vez de recortar el total a 0: asi lo que queda guardado
    // como descuento es lo que de verdad se aplico, y no una cifra mayor que
    // el documento no refleja.
    const pedido = dinero(data.discount ?? quote.discount);
    const discount = redondea(
      mayorQue(pedido, quote.subtotal) ? quote.subtotal : pedido,
    );
    const total = redondea(noNegativo(resta(quote.subtotal, discount)));

    return this.prisma.quote.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.validUntil !== undefined
          ? { validUntil: new Date(data.validUntil) }
          : {}),
        discount,
        total,
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
