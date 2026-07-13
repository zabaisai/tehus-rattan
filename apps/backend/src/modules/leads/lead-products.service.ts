import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const PRODUCT_SELECT = {
  id: true,
  name: true,
  category: true,
  imageUrl: true,
  price: true,
  sku: true,
  code: true,
};

type LeadProductWithProduct = {
  id: string;
  leadId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
    category: string | null;
    imageUrl: string | null;
    price: number;
    sku: string | null;
    code: string | null;
  };
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class LeadProductsService {
  constructor(private prisma: PrismaService) {}

  async findAllForLead(leadId: string, companyId: string) {
    await this.assertLeadOwnership(leadId, companyId);

    const items = await this.prisma.leadProduct.findMany({
      where: { leadId },
      include: { product: { select: PRODUCT_SELECT } },
      orderBy: { createdAt: 'asc' },
    });

    return items.map((item) => this.toResponse(item));
  }

  async addProduct(
    leadId: string,
    companyId: string,
    data: {
      productId: string;
      quantity?: number;
      unitPrice?: number;
      notes?: string;
    },
  ) {
    await this.assertLeadOwnership(leadId, companyId);

    const product = await this.prisma.product.findFirst({
      where: { id: data.productId, companyId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const quantity = data.quantity ?? 1;

    const existing = await this.prisma.leadProduct.findUnique({
      where: { leadId_productId: { leadId, productId: data.productId } },
    });

    let saved;
    if (existing) {
      // Already attached: add to the existing quantity instead of duplicating
      // the row. unitPrice/notes only change if this request explicitly sent
      // them — otherwise the previously snapshotted price/notes stay as-is.
      saved = await this.prisma.leadProduct.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + quantity,
          ...(data.unitPrice !== undefined ? { unitPrice: data.unitPrice } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
        include: { product: { select: PRODUCT_SELECT } },
      });
    } else {
      // Snapshot the product's current price — later edits to the catalog
      // price must never retroactively change what's already attached here.
      const unitPrice = data.unitPrice ?? product.price;
      saved = await this.prisma.leadProduct.create({
        data: {
          leadId,
          productId: data.productId,
          quantity,
          unitPrice,
          notes: data.notes,
        },
        include: { product: { select: PRODUCT_SELECT } },
      });
    }

    return this.toResponse(saved);
  }

  async update(
    leadId: string,
    leadProductId: string,
    companyId: string,
    data: { quantity?: number; unitPrice?: number; notes?: string },
  ) {
    await this.assertLeadOwnership(leadId, companyId);
    await this.findOwnedLeadProduct(leadId, leadProductId);

    const updated = await this.prisma.leadProduct.update({
      where: { id: leadProductId },
      data,
      include: { product: { select: PRODUCT_SELECT } },
    });

    return this.toResponse(updated);
  }

  async remove(leadId: string, leadProductId: string, companyId: string) {
    await this.assertLeadOwnership(leadId, companyId);
    await this.findOwnedLeadProduct(leadId, leadProductId);

    await this.prisma.leadProduct.delete({ where: { id: leadProductId } });
    return { id: leadProductId };
  }

  private async assertLeadOwnership(leadId: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
  }

  private async findOwnedLeadProduct(leadId: string, leadProductId: string) {
    const leadProduct = await this.prisma.leadProduct.findFirst({
      where: { id: leadProductId, leadId },
      select: { id: true },
    });
    if (!leadProduct) {
      throw new NotFoundException('Producto del lead no encontrado');
    }
    return leadProduct;
  }

  private toResponse(item: LeadProductWithProduct) {
    return {
      id: item.id,
      leadId: item.leadId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: round2(item.quantity * item.unitPrice),
      notes: item.notes,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      product: item.product,
    };
  }
}
