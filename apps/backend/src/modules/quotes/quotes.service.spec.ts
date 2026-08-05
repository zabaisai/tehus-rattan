import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QuotesService } from './quotes.service';

/**
 * Los importes son Decimal, no `number`: comparar con `toBe(80)` falla porque
 * un Decimal se serializa como "80". Lo que importa es el VALOR, y esta ayuda
 * lo compara sin volver a introducir coma flotante en la propia prueba.
 */
const importe = (v: unknown) => Number(v as never);

describe('QuotesService', () => {
  const companyId = 'company-a';
  const leadId = 'lead-a';
  let prisma: any;
  let service: QuotesService;

  beforeEach(() => {
    prisma = {
      lead: { findFirst: jest.fn() },
      leadProduct: { findMany: jest.fn() },
      quote: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      // El siguiente numero lo calcula la base con un MAX, no el proceso
      // trayendose todas las cotizaciones de la empresa.
      $queryRaw: jest.fn().mockResolvedValue([{ maximo: null }]),
    };
    service = new QuotesService(prisma);
  });

  const leadProductFixture = (overrides: Partial<any> = {}) => ({
    id: 'lp-1',
    leadId,
    productId: 'product-a',
    quantity: 2,
    unitPrice: 100,
    notes: null,
    product: {
      id: 'product-a',
      name: 'Sala Primavera',
      description: 'Ratán natural',
      category: 'Salas',
    },
    ...overrides,
  });

  describe('createFromLead', () => {
    it('rejects creating a quote for a lead outside the authenticated company', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.createFromLead('lead-b', companyId, 'user-a', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.leadProduct.findMany).not.toHaveBeenCalled();
      expect(prisma.quote.create).not.toHaveBeenCalled();
    });

    it('rejects creating a quote when the lead has no attached products', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([]);

      await expect(
        service.createFromLead(leadId, companyId, 'user-a', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.quote.create).not.toHaveBeenCalled();
    });

    it('creates a quote snapshotting each lead product into a quote item', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([
        leadProductFixture(),
        leadProductFixture({
          id: 'lp-2',
          productId: 'product-b',
          quantity: 1,
          unitPrice: 300,
          notes: 'Color natural',
          product: {
            id: 'product-b',
            name: 'Silla Colonial',
            description: null,
            category: 'Sillas',
          },
        }),
      ]);
      prisma.quote.findMany.mockResolvedValue([]);
      prisma.quote.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-1', ...args.data }),
      );

      const result = await service.createFromLead(
        leadId,
        companyId,
        'user-a',
        {},
      );

      const guardado = prisma.quote.create.mock.calls[0][0].data;
      expect(guardado).toEqual(
        expect.objectContaining({
          number: 'COT-0001',
          companyId,
          leadId,
          createdById: 'user-a',
        }),
      );
      expect(importe(guardado.subtotal)).toBe(500);
      expect(importe(guardado.discount)).toBe(0);
      expect(importe(guardado.total)).toBe(500);

      const lineas = guardado.items.create;
      expect(lineas[0]).toEqual(
        expect.objectContaining({
          productId: 'product-a',
          name: 'Sala Primavera',
          description: 'Ratán natural',
          category: 'Salas',
          quantity: 2,
          notes: null,
        }),
      );
      expect(importe(lineas[0].subtotal)).toBe(200);
      expect(lineas[1]).toEqual(
        expect.objectContaining({
          productId: 'product-b',
          name: 'Silla Colonial',
          category: 'Sillas',
          quantity: 1,
          notes: 'Color natural',
        }),
      );
      expect(importe(lineas[1].subtotal)).toBe(300);
      expect(result.number).toBe('COT-0001');
    });

    it('applies discount and never lets total go below 0', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([leadProductFixture()]); // subtotal 200
      prisma.quote.findMany.mockResolvedValue([]);
      prisma.quote.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-1', ...args.data }),
      );

      const result = await service.createFromLead(leadId, companyId, 'user-a', {
        discount: 500,
      });

      const guardado = prisma.quote.create.mock.calls[0][0].data;
      expect(importe(guardado.subtotal)).toBe(200);
      // El descuento se ACOTA al subtotal en vez de guardarse tal cual: lo que
      // queda registrado es lo que de verdad se aplicó, no una cifra que el
      // documento no refleja.
      expect(importe(guardado.discount)).toBe(200);
      expect(importe(guardado.total)).toBe(0);
      expect(importe(result.total)).toBe(0);
    });

    it('applies a partial discount correctly', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([leadProductFixture()]); // subtotal 200
      prisma.quote.findMany.mockResolvedValue([]);
      prisma.quote.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-1', ...args.data }),
      );

      const result = await service.createFromLead(leadId, companyId, 'user-a', {
        discount: 50,
      });

      expect(importe(result.subtotal)).toBe(200);
      expect(importe(result.discount)).toBe(50);
      expect(importe(result.total)).toBe(150);
    });

    it('generates the next sequential number based on the highest existing number', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([leadProductFixture()]);
      // El maximo lo devuelve la base, no el proceso.
      prisma.$queryRaw.mockResolvedValue([{ maximo: 3 }]);
      prisma.quote.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-4', ...args.data }),
      );

      const result = await service.createFromLead(
        leadId,
        companyId,
        'user-a',
        {},
      );

      expect(result.number).toBe('COT-0004');
    });

    it('generates COT-0001 for the first quote of a company', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: leadId });
      prisma.leadProduct.findMany.mockResolvedValue([leadProductFixture()]);
      prisma.quote.findMany.mockResolvedValue([]);
      prisma.quote.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-1', ...args.data }),
      );

      const result = await service.createFromLead(
        leadId,
        companyId,
        'user-a',
        {},
      );
      expect(result.number).toBe('COT-0001');
    });
  });

  describe('findAll', () => {
    it('lists only quotes scoped to the authenticated company', async () => {
      prisma.quote.findMany.mockResolvedValue([]);

      await service.findAll(companyId, {});

      expect(prisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId } }),
      );
    });

    it('applies leadId and status filters', async () => {
      prisma.quote.findMany.mockResolvedValue([]);

      await service.findAll(companyId, { leadId: 'lead-a', status: 'SENT' });

      expect(prisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, leadId: 'lead-a', status: 'SENT' },
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns a quote scoped to the authenticated company', async () => {
      prisma.quote.findFirst.mockResolvedValue({ id: 'quote-1', companyId });

      const result = await service.findById('quote-1', companyId);

      expect(prisma.quote.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'quote-1', companyId } }),
      );
      expect(result).toEqual({ id: 'quote-1', companyId });
    });

    it('rejects reading a quote belonging to another company', async () => {
      prisma.quote.findFirst.mockResolvedValue(null);

      await expect(
        service.findById('quote-b', companyId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("includes the owning company's fiscal identity (for the printable document)", async () => {
      prisma.quote.findFirst.mockResolvedValue({ id: 'quote-1', companyId });

      await service.findById('quote-1', companyId);

      const args = prisma.quote.findFirst.mock.calls[0][0];
      // Isolation: always scoped by both id AND companyId.
      expect(args.where).toEqual({ id: 'quote-1', companyId });
      // The company relation is included with an explicit fiscal/identity
      // select so the print view renders the quote's OWNER, not the viewer.
      expect(args.include.company).toBeDefined();
      const select = args.include.company.select;
      expect(select).toEqual(
        expect.objectContaining({
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
        }),
      );
    });

    it('returns the company identity of the quote owner (Empresa A never gets Empresa B data)', async () => {
      const companyAIdentity = {
        id: companyId,
        name: 'Empresa A',
        legalName: 'Empresa A S.A.S',
        taxId: 'A-111',
        email: 'a@empresa-a.test',
        phone: '+571111',
        address: 'Calle A',
        city: 'Ciudad A',
        country: 'País A',
        website: null,
        logoUrl: null,
        quoteFooter: null,
      };
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        companyId,
        company: companyAIdentity,
      });

      const result = await service.findById('quote-1', companyId);

      expect(result.company).toEqual(companyAIdentity);
      expect(result.company.taxId).toBe('A-111');
      expect(JSON.stringify(result)).not.toContain('Empresa B');
    });
  });

  describe('update', () => {
    it('updates the status of an owned quote', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        subtotal: 200,
        discount: 0,
      });
      prisma.quote.update.mockResolvedValue({ id: 'quote-1', status: 'SENT' });

      const result = await service.update('quote-1', companyId, {
        status: 'SENT',
      });

      const args = prisma.quote.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'quote-1' });
      expect(args.data.status).toBe('SENT');
      expect(importe(args.data.discount)).toBe(0);
      expect(importe(args.data.total)).toBe(200);
      expect(result.status).toBe('SENT');
    });

    it('recalculates total when discount changes', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        subtotal: 200,
        discount: 0,
      });
      prisma.quote.update.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-1', ...args.data }),
      );

      const result = await service.update('quote-1', companyId, {
        discount: 80,
      });

      expect(importe(result.discount)).toBe(80);
      expect(importe(result.total)).toBe(120);
    });

    it('keeps total at 0 when discount exceeds subtotal', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        subtotal: 200,
        discount: 0,
      });
      prisma.quote.update.mockImplementation((args: any) =>
        Promise.resolve({ id: 'quote-1', ...args.data }),
      );

      const result = await service.update('quote-1', companyId, {
        discount: 999,
      });

      expect(importe(result.total)).toBe(0);
      // El descuento guardado es el que cabe, no el pedido.
      expect(importe(result.discount)).toBe(200);
    });

    it('rejects updating a quote belonging to another company', async () => {
      prisma.quote.findFirst.mockResolvedValue(null);

      await expect(
        service.update('quote-b', companyId, { status: 'SENT' as any }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT quote', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        status: 'DRAFT',
      });
      prisma.quote.delete.mockResolvedValue({ id: 'quote-1' });

      const result = await service.remove('quote-1', companyId);

      expect(prisma.quote.delete).toHaveBeenCalledWith({
        where: { id: 'quote-1' },
      });
      expect(result).toEqual({ id: 'quote-1' });
    });

    it('deletes a SENT quote', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        status: 'SENT',
      });
      prisma.quote.delete.mockResolvedValue({ id: 'quote-1' });

      await service.remove('quote-1', companyId);

      expect(prisma.quote.delete).toHaveBeenCalledWith({
        where: { id: 'quote-1' },
      });
    });

    it('rejects deleting an ACCEPTED quote', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'quote-1',
        status: 'ACCEPTED',
      });

      await expect(service.remove('quote-1', companyId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.quote.delete).not.toHaveBeenCalled();
    });

    it('rejects deleting a quote belonging to another company', async () => {
      prisma.quote.findFirst.mockResolvedValue(null);

      await expect(service.remove('quote-b', companyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.quote.delete).not.toHaveBeenCalled();
    });
  });
});
