import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * Tipo de elemento (Fase 2) en el servicio de catálogo, con Prisma doblado.
 * La columna es nullable y las filas anteriores valen NULL: ninguna respuesta
 * puede exponer ese NULL, y ningún cliente antiguo puede crear una fila sin tipo.
 */
describe('ProductsService — itemType', () => {
  let prisma: any;
  let service: ProductsService;
  let configuracion: { resolveCapabilities: jest.Mock };

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    code: null,
    name: 'Silla',
    description: null,
    price: 100,
    imageUrl: null,
    category: 'Salas',
    sku: 'S-1',
    stock: 3,
    isActive: true,
    itemType: null,
    companyId: 'company-a',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }: any) => row({ ...data, id: 'new' })),
        update: jest.fn(async ({ where, data }: any) =>
          row({ ...where, ...data }),
        ),
      },
    };
    configuracion = {
      resolveCapabilities: jest.fn(async () => ({
        modules: {
          conversations: true,
          contacts: true,
          opportunities: true,
          pipeline: true,
          catalog: true,
          quotes: true,
          tasks: true,
        },
        legacyDefaultsApplied: [],
        catalog: {
          allowedItemTypes: ['PRODUCT', 'SERVICE'],
          defaultItemType: 'PRODUCT',
        },
        definitions: [],
      })),
    };
    service = new ProductsService(prisma, configuracion as any);
  });

  describe('findAll', () => {
    it('una fila legacy con itemType NULL se responde como PRODUCT', async () => {
      prisma.product.findMany.mockResolvedValue([
        row(),
        row({ id: 'p2', itemType: 'SERVICE' }),
      ]);
      const out = await service.findAll('company-a', {});
      expect(out.map((p) => p.itemType)).toEqual(['PRODUCT', 'SERVICE']);
    });

    it('sin filtro no añade condición de tipo; siempre filtra por empresa y activos', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll('company-a', {});
      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ companyId: 'company-a', isActive: true });
    });

    it('itemType=PRODUCT incluye las filas legacy en NULL', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll('company-a', { itemType: 'PRODUCT' });
      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ itemType: 'PRODUCT' }, { itemType: null }]);
      expect(where.companyId).toBe('company-a');
    });

    it('itemType=SERVICE filtra exacto y convive con categoría y búsqueda', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await service.findAll('company-a', {
        itemType: 'SERVICE',
        category: 'Consultas',
        search: 'vac',
      });
      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where.itemType).toBe('SERVICE');
      expect(where.category).toBe('Consultas');
      expect(where.OR).toHaveLength(3); // la búsqueda por nombre/código/sku
    });

    it('itemType inválido → 400 sin consultar', async () => {
      await expect(
        service.findAll('company-a', { itemType: 'OTRO' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('siempre por empresa: el id de otro tenant es un 404 genérico', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findById('p-de-b', 'company-a')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'p-de-b', companyId: 'company-a' },
      });
    });

    it('legacy NULL → PRODUCT en la respuesta', async () => {
      prisma.product.findFirst.mockResolvedValue(row());
      expect((await service.findById('p1', 'company-a')).itemType).toBe(
        'PRODUCT',
      );
    });
  });

  describe('create', () => {
    it('cliente antiguo que omite itemType → se persiste PRODUCT explícito (nunca NULL nuevo)', async () => {
      const out = await service.create('company-a', {
        name: 'Silla',
        price: 10,
      });
      expect(prisma.product.create.mock.calls[0][0].data).toEqual({
        name: 'Silla',
        price: 10,
        itemType: 'PRODUCT',
        companyId: 'company-a',
      });
      expect(out.itemType).toBe('PRODUCT');
    });

    it('SERVICE explícito se respeta y stock/sku siguen siendo opcionales', async () => {
      const out = await service.create('company-a', {
        name: 'Consulta',
        price: 50,
        itemType: 'SERVICE',
        sku: 'C-1',
        stock: 0,
      });
      expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
        itemType: 'SERVICE',
        sku: 'C-1',
        stock: 0,
        companyId: 'company-a',
      });
      expect(out.itemType).toBe('SERVICE');
    });

    it('la empresa viene del contexto, no del cuerpo', async () => {
      await service.create('company-a', {
        name: 'X',
        price: 1,
        companyId: 'company-b',
      } as any);
      expect(prisma.product.create.mock.calls[0][0].data.companyId).toBe(
        'company-a',
      );
    });
  });

  describe('update', () => {
    it('cambiar el tipo no borra stock ni sku: solo se envía lo que llega', async () => {
      prisma.product.findFirst.mockResolvedValue(row());
      await service.update('p1', 'company-a', { itemType: 'SERVICE' });
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { itemType: 'SERVICE' },
      });
    });

    it('un id de otro tenant → 404 y nada se escribe', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.update('p-de-b', 'company-a', { itemType: 'SERVICE' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });
});
