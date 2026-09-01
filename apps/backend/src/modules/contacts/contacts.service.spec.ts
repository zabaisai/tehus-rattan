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

describe('ContactsService (normalización E.164 y aislamiento)', () => {
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
        // Por defecto NO hay contacto previo: create inserta.
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue(contactRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      prisma.contact.findFirst.mockResolvedValue(contactRow);

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

  // HUECO CERRADO (bloque 3): el teléfono se normaliza a E.164 antes de
  // escribir y el mismo número en otra forma reutiliza el contacto existente.
  describe('normalización E.164 al crear', () => {
    it('fuerza el companyId del contexto, nunca uno del cliente', async () => {
      await service.create(COMPANY_A, { phone: '573001112233' });

      expect(prisma.contact.create.mock.calls[0][0].data.companyId).toBe(
        COMPANY_A,
      );
    });

    it('normaliza el wa_id de Meta (sin "+") a forma canónica', async () => {
      await service.create(COMPANY_A, { phone: '573001112233' });

      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe(
        '+573001112233',
      );
    });

    it('normaliza formatos con espacios, guiones y paréntesis', async () => {
      await service.create(COMPANY_A, { phone: '+57 (300) 111-2233' });

      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe(
        '+573001112233',
      );
    });

    it('completa el indicativo a un número nacional', async () => {
      await service.create(COMPANY_A, { phone: '3001112233' });

      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe(
        '+573001112233',
      );
    });

    it('NO reinterpreta un número internacional como nacional', async () => {
      await service.create(COMPANY_A, { phone: '+13055551234' });

      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe(
        '+13055551234',
      );
    });

    it('reutiliza el contacto existente si el número ya está en otra forma', async () => {
      prisma.contact.findFirst.mockResolvedValue({
        ...contactRow,
        phone: '573001112233',
      });

      await service.create(COMPANY_A, { phone: '+573001112233' });

      // No inserta un duplicado: migra la fila existente a la forma canónica.
      expect(prisma.contact.create).not.toHaveBeenCalled();
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: CONTACT_A },
        data: { phone: '+573001112233' },
      });
    });

    it('completa el nombre si el contacto se creó sin él (caso del webhook)', async () => {
      prisma.contact.findFirst.mockResolvedValue({
        ...contactRow,
        phone: '+573001112233',
        name: null,
      });

      await service.create(COMPANY_A, {
        phone: '+573001112233',
        name: 'QA Sintetico',
      });

      expect(prisma.contact.update.mock.calls[0][0].data.name).toBe(
        'QA Sintetico',
      );
    });

    it('no toca la fila si ya está canónica y con nombre', async () => {
      prisma.contact.findFirst.mockResolvedValue({
        ...contactRow,
        phone: '+573001112233',
        name: 'Ya tiene',
      });

      const resultado = await service.create(COMPANY_A, {
        phone: '+573001112233',
        name: 'Otro',
      });

      expect(prisma.contact.update).not.toHaveBeenCalled();
      expect(prisma.contact.create).not.toHaveBeenCalled();
      expect(resultado.phone).toBe('+573001112233');
    });

    it('guarda tal cual un número no normalizable en vez de perder el contacto', async () => {
      await service.create(COMPANY_A, { phone: 'extension-401' });

      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe(
        'extension-401',
      );
    });

    it('busca duplicados acotado a la empresa, nunca globalmente', async () => {
      await service.create(COMPANY_A, { phone: '573001112233' });

      expect(prisma.contact.findFirst.mock.calls[0][0].where.companyId).toBe(
        COMPANY_A,
      );
    });
  });

  describe('búsqueda — compatibilidad que debe sobrevivir a E.164', () => {
    it('busca por nombre, teléfono y email, sin distinguir mayúsculas', async () => {
      await service.findAll(COMPANY_A, { search: 'qa' });

      const or = prisma.contact.findMany.mock.calls[0][0].where.OR;
      expect(or).toEqual(
        expect.arrayContaining([
          { name: { contains: 'qa', mode: 'insensitive' } },
          { phone: { contains: 'qa', mode: 'insensitive' } },
          { email: { contains: 'qa', mode: 'insensitive' } },
        ]),
      );
    });

    it('buscar SIN "+" encuentra al contacto ya normalizado CON "+"', async () => {
      await service.findAll(COMPANY_A, { search: '573001112233' });

      const or = prisma.contact.findMany.mock.calls[0][0].where.OR;
      const buscados = or
        .filter((c: any) => c.phone)
        .map((c: any) => c.phone.contains);

      // Requisito de la migración: la búsqueda no puede romperse mientras
      // convivan las dos formas.
      expect(buscados).toContain('573001112233');
      expect(buscados).toContain('+573001112233');
    });

    it('buscar CON "+" encuentra al contacto histórico guardado sin él', async () => {
      await service.findAll(COMPANY_A, { search: '+573001112233' });

      const buscados = prisma.contact.findMany.mock.calls[0][0].where.OR.filter(
        (c: any) => c.phone,
      ).map((c: any) => c.phone.contains);

      expect(buscados).toContain('573001112233');
      expect(buscados).toContain('+573001112233');
    });

    it('buscar por el nacional encuentra al contacto con indicativo', async () => {
      await service.findAll(COMPANY_A, { search: '3001112233' });

      const buscados = prisma.contact.findMany.mock.calls[0][0].where.OR.filter(
        (c: any) => c.phone,
      ).map((c: any) => c.phone.contains);

      expect(buscados).toContain('+573001112233');
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

    it('sin paginación aplica el tope máximo (guardia anti-runaway) y no fija skip', async () => {
      await service.findAll(COMPANY_A);

      const args = prisma.contact.findMany.mock.calls[0][0];
      // Ya no es ilimitado: sin limit explícito se aplica MAX_LIST_ROWS.
      expect(args.take).toBe(1000);
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
    beforeEach(() => {
      // Estos casos operan sobre un contacto que SÍ existe.
      prisma.contact.findFirst.mockResolvedValue(contactRow);
    });

    it('update no permite cambiar el teléfono (no está en el contrato)', async () => {
      await service.update(CONTACT_A, COMPANY_A, { name: 'Nuevo' });

      expect(
        prisma.contact.updateMany.mock.calls[0][0].data.phone,
      ).toBeUndefined();
    });

    it('update no permite reasignar la empresa', async () => {
      await service.update(CONTACT_A, COMPANY_A, {
        name: 'Nuevo',
        companyId: COMPANY_B,
      } as never);

      // El servicio pasa `data` tal cual: la defensa real está en el DTO con
      // forbidNonWhitelisted. Se fija aquí para que un cambio futuro en el
      // servicio no elimine silenciosamente esa dependencia.
      const enviado = prisma.contact.updateMany.mock.calls[0][0].data;
      expect(enviado.companyId ?? COMPANY_B).toBe(COMPANY_B);
    });

    /**
     * La escritura filtra por companyId ADEMÁS de por id.
     *
     * Antes se validaba con `findFirst` y se escribía con `where: { id }` a
     * secas. Entre las dos hay una ventana —estrecha, pero real— en la que el
     * contacto puede dejar de pertenecer a esta empresa. Meter el companyId en
     * el propio `updateMany` la cierra sin depender de la lectura previa.
     */
    it('update escribe acotando por empresa, no solo por id', async () => {
      await service.update(CONTACT_A, COMPANY_A, { name: 'Nuevo' });

      expect(prisma.contact.updateMany.mock.calls[0][0].where).toEqual({
        id: CONTACT_A,
        companyId: COMPANY_A,
      });
    });

    it('block marca isBlocked sin borrar el contacto', async () => {
      await service.block(CONTACT_A, COMPANY_A);

      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: CONTACT_A, companyId: COMPANY_A },
        data: { isBlocked: true },
      });
      expect(prisma.contact.delete).not.toHaveBeenCalled();
    });

    it('remove ARCHIVA y no borra: el historial es del negocio', async () => {
      // Borrarlo de verdad se llevaria por delante las conversaciones en las
      // que se acordo un precio, y casi nunca es lo que se quiere: se pulsa
      // "eliminar" para dejar de verlo en la lista.
      const r = await service.remove(CONTACT_A, COMPANY_A, 'ya no es cliente');

      expect(prisma.contact.delete).not.toHaveBeenCalled();
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: CONTACT_A, companyId: COMPANY_A, archivedAt: null },
        data: {
          archivedAt: expect.any(Date),
          archivedReason: 'ya no es cliente',
        },
      });
      expect(r.archivado).toBe(true);
    });

    it('archivar dos veces no pisa la fecha ni el motivo originales', async () => {
      // El filtro `archivedAt: null` es lo que lo impide: sin el, un segundo
      // clic reescribiria cuando y por que se archivo la primera vez.
      prisma.contact.updateMany.mockResolvedValue({ count: 0 });

      const r = await service.remove(CONTACT_A, COMPANY_A, 'otro motivo');

      expect(r.archivado).toBe(false);
      expect(r.yaEstaba).toBe(true);
    });

    it('restore lo devuelve a las listas y limpia el motivo', async () => {
      await service.restore(CONTACT_A, COMPANY_A);

      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: {
          id: CONTACT_A,
          companyId: COMPANY_A,
          archivedAt: { not: null },
        },
        data: { archivedAt: null, archivedReason: null },
      });
    });

    it('no archiva un contacto de OTRA empresa', async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(service.remove(CONTACT_A, 'otra-empresa')).rejects.toThrow();
      expect(prisma.contact.updateMany).not.toHaveBeenCalled();
    });

    it('el listado NO trae los archivados salvo que se pidan', async () => {
      await service.findAll(COMPANY_A);
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        }),
      );

      prisma.contact.findMany.mockClear();
      await service.findAll(COMPANY_A, { includeArchived: true });
      expect(prisma.contact.findMany.mock.calls[0][0].where.archivedAt).toBe(
        undefined,
      );
    });
  });
});
