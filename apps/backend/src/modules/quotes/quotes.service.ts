import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, filters: { leadId?: string; status?: string }) {
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
        product: { select: { id: true, name: true, description: true, category: true } },
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
      subtotal: round2(lp.quantity * lp.unitPrice),
      notes: lp.notes,
    }));

    const subtotal = round2(itemsData.reduce((sum, item) => sum + item.subtotal, 0));
    const discount = data.discount ?? 0;
    const total = Math.max(0, round2(subtotal - discount));
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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

    const discount = data.discount ?? quote.discount;
    const total = Math.max(0, round2(quote.subtotal - discount));

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
      throw new BadRequestException('No se puede eliminar una cotización aceptada');
    }

    await this.prisma.quote.delete({ where: { id } });
    return { id };
  }

  private async generateNextNumber(companyId: string): Promise<string> {
    const quotes = await this.prisma.quote.findMany({
      where: { companyId },
      select: { number: true },
    });

    let max = 0;
    for (const quote of quotes) {
      const match = quote.number.match(/(\d+)$/);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (parsed > max) max = parsed;
      }
    }

    return `COT-${String(max + 1).padStart(4, '0')}`;
  }
}
