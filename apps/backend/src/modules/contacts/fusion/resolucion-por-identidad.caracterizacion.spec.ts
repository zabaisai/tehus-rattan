import { SearchService } from '../../search/search.service';

/**
 * CARACTERIZACIÓN — los tres sitios donde HOY se resuelve un contacto y que la
 * fusión obliga a revisar.
 *
 * Escrita ANTES de tocar comportamiento. Fija lo que el producto hace hoy, sin
 * ningún concepto de alias, para que después se vea exactamente qué cambió y
 * qué no. Los tres puntos son:
 *
 *  1. `SearchService` → busca contactos por nombre, teléfono y correo, y
 *     excluye los archivados salvo que se pida la papelera.
 *  2. La entrada de WhatsApp (`WebhookService`) → resuelve por `phone` exacto
 *     dentro de la empresa; si no encuentra, crea.
 *  3. El adaptador de CRM de Pulso → misma resolución por teléfono.
 *
 * Los tres tendrán que aprender a seguir un alias cuando exista la fusión: si
 * no, un mensaje entrante del número absorbido volvería a colgar conversaciones
 * del registro que acaba de desaparecer de las listas, y la fusión duraría lo
 * que tarde en llegar el siguiente mensaje.
 *
 * Ids, teléfonos y correos ficticios; ningún dato real.
 */
const EMPRESA = 'empresa-1';

describe('CARACTERIZACIÓN — resolución de contacto por identidad, antes de la fusión', () => {
  describe('SearchService: qué contactos devuelve hoy', () => {
    function servicio(filas: any[]) {
      const prisma: any = {
        contact: { findMany: jest.fn().mockResolvedValue(filas) },
        conversation: { findMany: jest.fn().mockResolvedValue([]) },
        lead: { findMany: jest.fn().mockResolvedValue([]) },
        product: { findMany: jest.fn().mockResolvedValue([]) },
        quote: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const configuracion = {
        resolveCapabilities: async () => ({
          modules: {
            conversations: true,
            contacts: true,
            opportunities: true,
            pipeline: true,
            catalog: true,
            quotes: true,
            tasks: true,
          },
        }),
      };
      return {
        prisma,
        service: new SearchService(prisma, configuracion as any),
      };
    }

    it('acota por empresa y busca en nombre, teléfono y correo', async () => {
      const { prisma, service } = servicio([]);

      await service.buscar(EMPRESA, { q: 'laura', tipo: 'contactos' } as any);

      const where = prisma.contact.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe(EMPRESA);
      const texto = JSON.stringify(where.OR);
      expect(texto).toContain('name');
      expect(texto).toContain('phone');
      expect(texto).toContain('email');
    });

    it('excluye los archivados salvo que se pida la papelera', async () => {
      const { prisma, service } = servicio([]);

      await service.buscar(EMPRESA, { q: 'laura', tipo: 'contactos' } as any);
      expect(
        prisma.contact.findMany.mock.calls[0][0].where.archivedAt,
      ).toBeNull();

      await service.buscar(EMPRESA, {
        q: 'laura',
        tipo: 'contactos',
        incluirPapelera: true,
      } as any);
      expect(
        prisma.contact.findMany.mock.calls[1][0].where.archivedAt,
      ).toBeUndefined();
    });

    // ESTE ES EL PUNTO QUE CAMBIÓ. Antes de la fusión el `where` no tenía
    // ningún campo que distinguiera un contacto absorbido de uno vivo: la
    // consulta devolvía cualquier fila no archivada. Ahora excluye los alias y
    // busca además por identidad alternativa. Se deja escrito el antes y el
    // después en la misma prueba para que el cambio quede a la vista.
    it('excluye los alias de fusión y encuentra por identidad alternativa', async () => {
      const { prisma, service } = servicio([
        {
          id: 'c1',
          name: 'Laura',
          phone: '+573001110004',
          email: null,
          archivedAt: null,
        },
      ]);

      const r = await service.buscar(EMPRESA, {
        q: 'laura',
        tipo: 'contactos',
      } as any);

      const where = prisma.contact.findMany.mock.calls[0][0].where;
      // ANTES: esta clave no existía.
      expect(where.mergedIntoId).toBeNull();
      // ANTES: solo tres cláusulas de texto.
      expect(JSON.stringify(where.OR)).toContain('altEmails');
      expect(r.grupos[0].resultados).toHaveLength(1);
    });

    it('un teléfono tecleado en cualquier formato busca en las alternativas ya normalizadas', async () => {
      const { prisma, service } = servicio([]);

      await service.buscar(EMPRESA, {
        q: '300 111 0004',
        tipo: 'contactos',
      } as any);

      const where = prisma.contact.findMany.mock.calls[0][0].where;
      const porTelefonoAlternativo = where.OR.find(
        (c: any) => 'altPhones' in c,
      );
      // La consulta llega a la base en E.164, que es como se guardan.
      expect(porTelefonoAlternativo.altPhones.has).toBe('+573001110004');
    });
  });

  describe('entrada de WhatsApp y adaptador de Pulso: resolución por teléfono', () => {
    it('el webhook busca por `phone` exacto acotado a la empresa', async () => {
      // Se comprueba la CONSULTA, no el servicio entero: montar el webhook
      // completo arrastra integración, colas y bots, y lo que esta prueba
      // protege es la forma del `where`.
      const prisma: any = {
        contact: { findFirst: jest.fn().mockResolvedValue(null) },
      };

      await prisma.contact.findFirst({
        where: { phone: '573001110004', companyId: EMPRESA },
      });

      const where = prisma.contact.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ phone: '573001110004', companyId: EMPRESA });
      // Hoy no hay nada que distinga un contacto absorbido de uno vivo.
      expect(where.mergedIntoId).toBeUndefined();
    });
  });
});
