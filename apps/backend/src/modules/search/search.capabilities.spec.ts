import { SearchService, tiposPermitidos } from './search.service';
import { TIPOS_BUSCABLES } from './dto/search-query.dto';

/**
 * La búsqueda global no consulta ni devuelve los tipos de un módulo que la
 * empresa tiene desactivado, aunque el cliente los pida a propósito.
 */
describe('SearchService — tipos según capacidades (Fase 4)', () => {
  const todos = {
    conversations: true as const,
    contacts: true as const,
    opportunities: true as const,
    pipeline: true as const,
    catalog: true,
    quotes: true,
    tasks: true,
  };

  it('tiposPermitidos deja fuera productos sin catálogo y cotizaciones sin cotizaciones', () => {
    expect(
      tiposPermitidos(TIPOS_BUSCABLES, { ...todos, catalog: false }),
    ).toEqual(['contactos', 'conversaciones', 'oportunidades', 'cotizaciones']);
    expect(
      tiposPermitidos(TIPOS_BUSCABLES, { ...todos, quotes: false }),
    ).toEqual(['contactos', 'conversaciones', 'oportunidades', 'productos']);
    expect(tiposPermitidos(TIPOS_BUSCABLES, todos)).toEqual([
      ...TIPOS_BUSCABLES,
    ]);
  });

  it('con el catálogo desactivado no se consulta la tabla de productos ni al pedirlo', async () => {
    const prisma: any = {
      contact: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      conversation: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      quote: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const configuration: any = {
      resolveCapabilities: jest.fn(async () => ({
        modules: { ...todos, catalog: false },
      })),
    };
    const service = new SearchService(prisma, configuration);
    const r = await service.buscar('empresa-a', {
      q: 'silla',
      tipos: ['productos', 'contactos'],
    });
    expect(configuration.resolveCapabilities).toHaveBeenCalledWith('empresa-a');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.contact.findMany).toHaveBeenCalled();
    expect(r.grupos.map((g) => g.tipo)).not.toContain('productos');
  });
});
