import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * El tipo de elemento que se CREA obedece al modelo comercial de la empresa
 * (Fase 4). Leer filas heredadas del otro tipo sigue funcionando: aquí solo
 * se decide lo nuevo y lo que se cambia a mano.
 */
describe('ProductsService — tipo de elemento según el modelo comercial', () => {
  let prisma: any;
  let caps: any;
  let service: ProductsService;

  const conModelo = (allowed: string[], def: string) => {
    caps.resolveCapabilities.mockResolvedValue({
      modules: { catalog: true },
      catalog: { allowedItemTypes: allowed, defaultItemType: def },
    });
  };

  beforeEach(() => {
    prisma = {
      product: {
        create: jest.fn(async ({ data }: any) => ({ id: 'p', ...data })),
        update: jest.fn(async ({ where, data }: any) => ({
          id: where.id,
          itemType: null,
          ...data,
        })),
        findFirst: jest.fn(async () => ({
          id: 'p',
          companyId: 'a',
          itemType: 'PRODUCT',
        })),
      },
    };
    caps = { resolveCapabilities: jest.fn() };
    service = new ProductsService(prisma, caps);
  });

  it('«solo servicios»: omitir itemType crea SERVICE y PRODUCT se rechaza', async () => {
    conModelo(['SERVICE'], 'SERVICE');
    const creado = await service.create('a', {
      name: 'Consultoría',
      price: 10,
    });
    expect(creado.itemType).toBe('SERVICE');
    expect(prisma.product.create.mock.calls[0][0].data.itemType).toBe(
      'SERVICE',
    );
    await expect(
      service.create('a', { name: 'Silla', price: 10, itemType: 'PRODUCT' }),
    ).rejects.toThrow(/solo servicios/);
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
  });

  it('«solo productos»: omitir crea PRODUCT y SERVICE se rechaza', async () => {
    conModelo(['PRODUCT'], 'PRODUCT');
    const creado = await service.create('a', { name: 'Silla', price: 10 });
    expect(creado.itemType).toBe('PRODUCT');
    await expect(
      service.create('a', { name: 'Armado', price: 10, itemType: 'SERVICE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mixto o desconocido: ambos tipos, PRODUCT por defecto', async () => {
    conModelo(['PRODUCT', 'SERVICE'], 'PRODUCT');
    await service.create('a', { name: 'X', price: 1 });
    await service.create('a', { name: 'Y', price: 1, itemType: 'SERVICE' });
    expect(
      prisma.product.create.mock.calls.map((c: any) => c[0].data.itemType),
    ).toEqual(['PRODUCT', 'SERVICE']);
  });

  it('editar sin tocar el tipo deja una fila heredada como está', async () => {
    conModelo(['SERVICE'], 'SERVICE');
    await service.update('p', 'a', { price: 20 });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p' },
      data: { price: 20 },
    });
    expect(caps.resolveCapabilities).not.toHaveBeenCalled();
  });

  it('cambiar el tipo a uno no permitido se rechaza antes de escribir', async () => {
    conModelo(['SERVICE'], 'SERVICE');
    await expect(
      service.update('p', 'a', { itemType: 'PRODUCT' }),
    ).rejects.toThrow(/solo servicios/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('resuelve las capacidades de la empresa del contexto, nunca de otra', async () => {
    conModelo(['PRODUCT', 'SERVICE'], 'PRODUCT');
    await service.create('empresa-a', { name: 'X', price: 1 });
    expect(caps.resolveCapabilities).toHaveBeenCalledWith('empresa-a');
  });
});
