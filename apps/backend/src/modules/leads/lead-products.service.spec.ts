import { NotFoundException } from '@nestjs/common';
import { LeadProductsService } from './lead-products.service';

describe('LeadProductsService', () => {
  const companyId = 'company-a';
  const leadId = 'lead-a';
  let prisma: any;
  let service: LeadProductsService;

  beforeEach(() => {
    prisma = {
      lead: { findFirst: jest.fn() },
      product: { findFirst: jest.fn() },
      leadProduct: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new LeadProductsService(prisma);
  });

  describe('findAllForLead', () => {
    it('lists products attached to a lead owned by the company', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([
        {
          id: 'lp-1',
          leadId,
          productId: 'product-a',
          quantity: 2,
          unitPrice: 100,
          notes: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          product: {
            id: 'product-a',
            name: 'Sala Primavera',
            category: 'Salas',
            imageUrl: null,
            price: 100,
            sku: null,
            code: null,
          },
        },
      ]);

      const result = await service.findAllForLead(leadId, companyId);

      expect(prisma.lead.findFirst).toHaveBeenCalledWith({
        where: { id: leadId, companyId },
        select: { id: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].subtotal).toBe(200);
      expect(result[0].product.name).toBe('Sala Primavera');
    });

    it('rejects listing products for a lead outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(service.findAllForLead('lead-b', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.leadProduct.findMany).not.toHaveBeenCalled();
    });
  });

  describe('addProduct', () => {
    beforeEach(() => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
    });

    it('rejects attaching a product that belongs to another company', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.addProduct(leadId, companyId, { productId: 'product-other-company' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'product-other-company', companyId },
      });
      expect(prisma.leadProduct.create).not.toHaveBeenCalled();
    });

    it('rejects attaching a product to a lead outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.addProduct('lead-b', companyId, { productId: 'product-a' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.product.findFirst).not.toHaveBeenCalled();
    });

    it('copies the product current price into unitPrice when none is provided', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-a',
        price: 11700000,
        companyId,
      });
      prisma.leadProduct.findUnique.mockResolvedValue(null);
      prisma.leadProduct.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: 'lp-1',
          ...args.data,
          product: { id: 'product-a', name: 'Sala Primavera', category: null, imageUrl: null, price: 11700000, sku: null, code: null },
        }),
      );

      const result = await service.addProduct(leadId, companyId, { productId: 'product-a' });

      expect(prisma.leadProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPrice: 11700000, quantity: 1 }),
        }),
      );
      expect(result.unitPrice).toBe(11700000);
      expect(result.subtotal).toBe(11700000);
    });

    it('uses the explicit unitPrice instead of the product price when provided', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-a', price: 100, companyId });
      prisma.leadProduct.findUnique.mockResolvedValue(null);
      prisma.leadProduct.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: 'lp-1',
          ...args.data,
          product: { id: 'product-a', name: 'Sala Primavera', category: null, imageUrl: null, price: 100, sku: null, code: null },
        }),
      );

      const result = await service.addProduct(leadId, companyId, {
        productId: 'product-a',
        unitPrice: 90,
      });

      expect(result.unitPrice).toBe(90);
    });

    it('merges quantity into the existing row instead of duplicating when the product is already attached', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-a', price: 100, companyId });
      prisma.leadProduct.findUnique.mockResolvedValue({
        id: 'lp-1',
        leadId,
        productId: 'product-a',
        quantity: 2,
        unitPrice: 100,
        notes: null,
      });
      prisma.leadProduct.update.mockImplementation((args: any) =>
        Promise.resolve({
          id: 'lp-1',
          leadId,
          productId: 'product-a',
          unitPrice: 100,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
          product: { id: 'product-a', name: 'Sala Primavera', category: null, imageUrl: null, price: 100, sku: null, code: null },
        }),
      );

      const result = await service.addProduct(leadId, companyId, {
        productId: 'product-a',
        quantity: 3,
      });

      expect(prisma.leadProduct.create).not.toHaveBeenCalled();
      expect(prisma.leadProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lp-1' },
          data: expect.objectContaining({ quantity: 5 }),
        }),
      );
      expect(result.quantity).toBe(5);
    });

    it('overrides unitPrice on merge only when explicitly provided', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-a', price: 100, companyId });
      prisma.leadProduct.findUnique.mockResolvedValue({
        id: 'lp-1',
        leadId,
        productId: 'product-a',
        quantity: 1,
        unitPrice: 100,
        notes: null,
      });
      prisma.leadProduct.update.mockImplementation((args: any) => Promise.resolve({
        id: 'lp-1',
        leadId,
        productId: 'product-a',
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        unitPrice: 100,
        quantity: 1,
        ...args.data,
        product: { id: 'product-a', name: 'X', category: null, imageUrl: null, price: 100, sku: null, code: null },
      }));

      await service.addProduct(leadId, companyId, { productId: 'product-a', quantity: 1 });
      expect(prisma.leadProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ unitPrice: expect.anything() }),
        }),
      );
    });
  });

  describe('update', () => {
    it('updates quantity on an owned lead product', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findFirst.mockResolvedValue({ id: 'lp-1' });
      prisma.leadProduct.update.mockResolvedValue({
        id: 'lp-1',
        leadId,
        productId: 'product-a',
        quantity: 4,
        unitPrice: 100,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        product: { id: 'product-a', name: 'X', category: null, imageUrl: null, price: 100, sku: null, code: null },
      });

      const result = await service.update(leadId, 'lp-1', companyId, { quantity: 4 });

      expect(prisma.leadProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lp-1' }, data: { quantity: 4 } }),
      );
      expect(result.quantity).toBe(4);
      expect(result.subtotal).toBe(400);
    });

    it('updates unitPrice on an owned lead product', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findFirst.mockResolvedValue({ id: 'lp-1' });
      prisma.leadProduct.update.mockResolvedValue({
        id: 'lp-1',
        leadId,
        productId: 'product-a',
        quantity: 2,
        unitPrice: 80,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        product: { id: 'product-a', name: 'X', category: null, imageUrl: null, price: 100, sku: null, code: null },
      });

      const result = await service.update(leadId, 'lp-1', companyId, { unitPrice: 80 });

      expect(result.unitPrice).toBe(80);
      expect(result.subtotal).toBe(160);
    });

    it('rejects updating a lead product for a lead outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.update('lead-b', 'lp-1', companyId, { quantity: 2 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.leadProduct.update).not.toHaveBeenCalled();
    });

    it('rejects updating a lead product that does not belong to the given lead', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findFirst.mockResolvedValue(null);

      await expect(
        service.update(leadId, 'lp-other-lead', companyId, { quantity: 2 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.leadProduct.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned lead product association without touching the catalog product', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findFirst.mockResolvedValue({ id: 'lp-1' });
      prisma.leadProduct.delete.mockResolvedValue({ id: 'lp-1' });

      const result = await service.remove(leadId, 'lp-1', companyId);

      expect(prisma.leadProduct.delete).toHaveBeenCalledWith({ where: { id: 'lp-1' } });
      expect(result).toEqual({ id: 'lp-1' });
    });

    it('rejects deleting a lead product for a lead outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(service.remove('lead-b', 'lp-1', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.leadProduct.delete).not.toHaveBeenCalled();
    });

    it('rejects deleting a lead product that does not belong to the given lead', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findFirst.mockResolvedValue(null);

      await expect(service.remove(leadId, 'lp-other', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.leadProduct.delete).not.toHaveBeenCalled();
    });
  });
});
