import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';

/**
 * CARACTERIZACIÓN — puerta de la normalización E.164.
 *
 * Fija lo que el módulo hace HOY, antes del backfill de teléfonos. Los dos
 * hechos que condicionan esa migración quedan aquí como pruebas explícitas:
 *
 *  1. `create` guarda el teléfono EXACTAMENTE como llega. No normaliza, no
 *     añade `+`, no deduplica. Por eso los contactos creados por el webhook
 *     quedaron sin prefijo (Meta entrega `wa_id` sin `+`).
 *  2. La búsqueda es un `contains` sobre el texto crudo. Cuando los teléfonos
 *     pasen a E.164, buscar sin `+` debe seguir encontrando al contacto — esa
 *     compatibilidad es requisito, no un extra.
 *
 * Además fija el borrado DURO actual, relevante para el trabajo de retención
 * y soft delete.
 *
 * Ids y teléfonos ficticios; ningún dato real.
 */
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const CONTACT_A = 'contact-a';

describe('ContactsService (caracterización pre-E.164)', () => {
  let prisma: any;
  let service: ContactsService;

  const contactRow = {
    id: CONTACT_A,
    companyId: COMPANY_A,
    phone: '573001112233',
    name: 'QA Sintetico',
    email: null,
    tags: [],
    isBlocked: false,
  };

  beforeEach(() => {
    prisma = {
      contact: {
        findMany: jest.fn().mockResolvedValue([contactRow]),
        findFirst: jest.fn().mockResolvedValue(contactRow),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue(contactRow),
      },
    };
    service = new ContactsService(prisma);
  });

  describe('aislamiento multiempresa', () => {
    it('findAll filtra siempre por companyId', async () => {
      await service.findAll(COMPANY_A);

      expect(prisma.contact.findMany.mock.calls[0][0].where.companyId).toBe(
        COMPANY_A,
      );
    });

    it('findById exige coincidencia de id y empresa', async () => {
      await service.findById(CONTACT_A, COMPANY_A);

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: CONTACT_A, companyId: COMPANY_A },
      });
    });

    it.each([
      ['findById', () => service.findById(CONTACT_A, COMPANY_B)],
      ['update', () => service.update(CONTACT_A, COMPANY_B, { name: 'X' })],
      ['remove', () => service.remove(CONTACT_A, COMPANY_B)],
      ['block', () => service.block(CONTACT_A, COMPANY_B)],
    ])(
      '%s falla con 404 y no escribe nada si el contacto es de otra empresa',
      async (_name, call) => {
        prisma.contact.findFirst.mockResolvedValue(null);

        await expect(call()).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.contact.update).not.toHaveBeenCalled();
        expect(prisma.contact.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('creación — comportamiento que la migración E.164 va a cambiar', () => {
    it('fuerza el companyId del contexto, nunca uno del cliente', async () => {
      await service.create(COMPANY_A, { phone: '573001112233' });

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: { phone: '573001112233', companyId: COMPANY_A },
      });
    });

    it('HOY guarda el teléfono tal cual, sin normalizar ni añadir "+"', async () => {
      await service.create(COMPANY_A, { phone: '573001112233' });

      const guardado = prisma.contact.create.mock.calls[0][0].data.phone;
      expect(guardado).toBe('573001112233');
      expect(guardado.startsWith('+')).toBe(false);
    });

    it('HOY no normaliza formatos con espacios, guiones o paréntesis', async () => {
      await service.create(COMPANY_A, { phone: '+57 (300) 111-2233' });

      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe(
        '+57 (300) 111-2233',
      );
    });

    it('HOY no deduplica: dos formatos del mismo número son dos llamadas distintas', async () => {
      await service.create(COMPANY_A, { phone: '573001112233' });
      await service.create(COMPANY_A, { phone: '+573001112233' });

      // La única defensa actual es el índice único (phone, companyId), que no
      // ve estos dos valores como iguales. Tras E.164 deben colapsar en uno.
      expect(prisma.contact.create).toHaveBeenCalledTimes(2);
      expect(prisma.contact.create.mock.calls[0][0].data.phone).not.toBe(
        prisma.contact.create.mock.calls[1][0].data.phone,
      );
    });
  });

  describe('búsqueda — compatibilidad que debe sobrevivir a E.164', () => {
    it('busca por nombre, teléfono y email, sin distinguir mayúsculas', async () => {
      await service.findAll(COMPANY_A, { search: 'qa' });

      const or = prisma.contact.findMany.mock.calls[0][0].where.OR;
      expect(or).toEqual([
        { name: { contains: 'qa', mode: 'insensitive' } },
        { phone: { contains: 'qa', mode: 'insensitive' } },
        { email: { contains: 'qa', mode: 'insensitive' } },
      ]);
    });

    it('sin término de búsqueda no añade cláusula OR', async () => {
      await service.findAll(COMPANY_A);

      expect(prisma.contact.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    });

    it('ordena por fecha de creación descendente', async () => {
      await service.findAll(COMPANY_A);

      expect(prisma.contact.findMany.mock.calls[0][0].orderBy).toEqual({
        createdAt: 'desc',
      });
    });
  });

  describe('paginación', () => {
    it('acepta limit y offset válidos', async () => {
      await service.findAll(COMPANY_A, { limit: '50', offset: '10' });

      const args = prisma.contact.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
      expect(args.skip).toBe(10);
    });

    it('sin paginación no fija take ni skip', async () => {
      await service.findAll(COMPANY_A);

      const args = prisma.contact.findMany.mock.calls[0][0];
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    });

    it.each([['0'], ['101'], ['-1'], ['abc'], ['1.5']])(
      'rechaza limit inválido (%s) sin consultar la base',
      async (limit) => {
        await expect(
          service.findAll(COMPANY_A, { limit }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.contact.findMany).not.toHaveBeenCalled();
      },
    );

    it.each([['-1'], ['abc'], ['2.5']])(
      'rechaza offset inválido (%s) sin consultar la base',
      async (offset) => {
        await expect(
          service.findAll(COMPANY_A, { offset }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.contact.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('actualización y bloqueo', () => {
    it('update no permite cambiar el teléfono (no está en el contrato)', async () => {
      await service.update(CONTACT_A, COMPANY_A, { name: 'Nuevo' });

      expect(prisma.contact.update.mock.calls[0][0].data.phone).toBeUndefined();
    });

    it('update no permite reasignar la empresa', async () => {
      await service.update(CONTACT_A, COMPANY_A, {
        name: 'Nuevo',
        companyId: COMPANY_B,
      } as never);

      // El servicio pasa `data` tal cual: la defensa real está en el DTO con
      // forbidNonWhitelisted. Se fija aquí para que un cambio futuro en el
      // servicio no elimine silenciosamente esa dependencia.
      const enviado = prisma.contact.update.mock.calls[0][0].data;
      expect(enviado.companyId ?? COMPANY_B).toBe(COMPANY_B);
    });

    it('block marca isBlocked sin borrar el contacto', async () => {
      await service.block(CONTACT_A, COMPANY_A);

      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: CONTACT_A },
        data: { isBlocked: true },
      });
      expect(prisma.contact.delete).not.toHaveBeenCalled();
    });

    it('HOY remove borra en duro, no es soft delete (relevante para retención)', async () => {
      await service.remove(CONTACT_A, COMPANY_A);

      expect(prisma.contact.delete).toHaveBeenCalledWith({
        where: { id: CONTACT_A },
      });
    });
  });
});
