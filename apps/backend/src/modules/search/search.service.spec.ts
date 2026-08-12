import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from './search.service';

/** Prisma falso: interesa QUÉ `where` se construye, no qué devuelve la base. */
function prismaFalso() {
  return {
    contact: { findMany: jest.fn().mockResolvedValue([]) },
    conversation: { findMany: jest.fn().mockResolvedValue([]) },
    lead: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    quote: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('SearchService', () => {
  let service: SearchService;
  let prisma: ReturnType<typeof prismaFalso>;

  beforeEach(async () => {
    prisma = prismaFalso();
    const moduleRef = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SearchService);
  });

  describe('aislamiento multiempresa', () => {
    it('TODA consulta lleva companyId en el where, no filtra después', async () => {
      // Una consulta que trae filas de otra empresa y luego las descarta ya las
      // ha traído: basta un `return` mal puesto para que salgan.
      await service.buscar('empresa-1', { q: 'laura' });

      for (const tabla of ['contact', 'conversation', 'lead', 'product', 'quote'] as const) {
        expect(prisma[tabla].findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ companyId: 'empresa-1' }),
          }),
        );
      }
    });

    it('nunca consulta con un companyId distinto del recibido', async () => {
      await service.buscar('empresa-1', { q: 'laura' });

      const todas = [
        ...prisma.contact.findMany.mock.calls,
        ...prisma.conversation.findMany.mock.calls,
        ...prisma.lead.findMany.mock.calls,
        ...prisma.product.findMany.mock.calls,
        ...prisma.quote.findMany.mock.calls,
      ];
      expect(todas).not.toHaveLength(0);
      for (const [args] of todas) {
        expect(args.where.companyId).toBe('empresa-1');
      }
    });
  });

  describe('papelera', () => {
    it('por defecto excluye los contactos archivados', async () => {
      await service.buscar('empresa-1', { q: 'laura' });

      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        }),
      );
    });

    it('los incluye cuando se piden explícitamente', async () => {
      await service.buscar('empresa-1', { q: 'laura', incluirPapelera: true });

      const [args] = prisma.contact.findMany.mock.calls[0];
      expect(args.where).not.toHaveProperty('archivedAt');
    });

    it('marca el resultado archivado para que la interfaz lo distinga', async () => {
      prisma.contact.findMany.mockResolvedValue([
        { id: 'c1', name: 'Laura', phone: '+57300', email: null, archivedAt: new Date() },
      ]);

      const r = await service.buscar('e1', { q: 'laura', incluirPapelera: true, tipos: ['contactos'] });

      expect(r.grupos[0].resultados[0]).toMatchObject({
        archivado: true,
        insignia: 'En papelera',
      });
    });
  });

  describe('selección de tipos', () => {
    it('sin tipos consulta las cinco entidades', async () => {
      await service.buscar('e1', { q: 'laura' });

      expect(prisma.contact.findMany).toHaveBeenCalled();
      expect(prisma.conversation.findMany).toHaveBeenCalled();
      expect(prisma.lead.findMany).toHaveBeenCalled();
      expect(prisma.product.findMany).toHaveBeenCalled();
      expect(prisma.quote.findMany).toHaveBeenCalled();
    });

    it('con tipos consulta SOLO esos, no todos y luego filtra', async () => {
      await service.buscar('e1', { q: 'laura', tipos: ['productos'] });

      expect(prisma.product.findMany).toHaveBeenCalled();
      expect(prisma.contact.findMany).not.toHaveBeenCalled();
      expect(prisma.quote.findMany).not.toHaveBeenCalled();
    });
  });

  describe('límite', () => {
    it('sin límite pide 5 por tipo: es una paleta, no un listado', async () => {
      await service.buscar('e1', { q: 'laura', tipos: ['contactos'] });

      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('respeta el límite pedido', async () => {
      await service.buscar('e1', { q: 'laura', tipos: ['contactos'], limite: 12 });

      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 12 }),
      );
    });
  });

  describe('forma del resultado', () => {
    it('los grupos vacíos no se devuelven: no hay pestañas muertas', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Sala', sku: 'SKU1', code: null, category: 'Salas' },
      ]);

      const r = await service.buscar('e1', { q: 'sala' });

      expect(r.grupos.map((g) => g.tipo)).toEqual(['productos']);
      expect(r.total).toBe(1);
    });

    it('un contacto sin nombre se muestra por su teléfono, no vacío', async () => {
      prisma.contact.findMany.mockResolvedValue([
        { id: 'c1', name: null, phone: '+573001112233', email: null, archivedAt: null },
      ]);

      const r = await service.buscar('e1', { q: '300', tipos: ['contactos'] });

      expect(r.grupos[0].resultados[0].titulo).toBe('+573001112233');
    });

    it('no devuelve URLs: la ruta es del frontend', async () => {
      prisma.lead.findMany.mockResolvedValue([
        {
          id: 'l1',
          title: 'Sala Toscana',
          status: 'OPEN',
          stage: { name: 'Negociación' },
          contact: { id: 'c1', name: 'Laura', phone: '+57300' },
        },
      ]);

      const r = await service.buscar('e1', { q: 'sala', tipos: ['oportunidades'] });
      const resultado = r.grupos[0].resultados[0];

      expect(resultado).not.toHaveProperty('enlace');
      expect(resultado).not.toHaveProperty('url');
      expect(resultado).toMatchObject({ tipo: 'oportunidades', id: 'l1', contactoId: 'c1' });
    });

    it('la búsqueda no distingue mayúsculas', async () => {
      await service.buscar('e1', { q: 'LAURA', tipos: ['contactos'] });

      const [args] = prisma.contact.findMany.mock.calls[0];
      for (const clausula of args.where.OR) {
        const campo = Object.values(clausula)[0] as { mode?: string };
        expect(campo.mode).toBe('insensitive');
      }
    });

    it('recorta espacios de la consulta', async () => {
      const r = await service.buscar('e1', { q: '  laura  ', tipos: ['contactos'] });

      expect(r.consulta).toBe('laura');
      const [args] = prisma.contact.findMany.mock.calls[0];
      expect(args.where.OR[0].name.contains).toBe('laura');
    });
  });
});
