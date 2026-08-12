import { PrismaService } from '../src/prisma/prisma.service';
import { SearchService } from '../src/modules/search/search.service';

// Habla con un Postgres REAL, como `leads-delete.e2e-spec.ts`, porque lo que
// se quiere demostrar es que dos empresas con datos IDÉNTICOS no se ven entre
// sí. Con un Prisma simulado la prueba solo comprobaría que se escribió
// `companyId` en el `where`; aquí comprueba que la base efectivamente no
// devuelve la fila de la otra empresa.
//
// Requiere `docker compose up -d postgres` con el esquema migrado.
describe('SearchService — aislamiento multiempresa (e2e, base real)', () => {
  let prisma: PrismaService;
  let service: SearchService;

  // Dos empresas con EL MISMO texto en todo. Si hubiera fuga, el nombre
  // compartido la haría evidente.
  const TERMINO = 'ZZQA Aislamiento';
  let empresaA: string;
  let empresaB: string;
  let contactoA: string;
  let contactoB: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SearchService(prisma);

    const a = await prisma.company.create({
      data: { name: 'E2E Search Co A' },
    });
    const b = await prisma.company.create({
      data: { name: 'E2E Search Co B' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const [ca, cb] = await Promise.all([
      prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: '+19990000001',
          name: `${TERMINO} Contacto`,
        },
      }),
      prisma.contact.create({
        data: {
          companyId: empresaB,
          phone: '+19990000002',
          name: `${TERMINO} Contacto`,
        },
      }),
    ]);
    contactoA = ca.id;
    contactoB = cb.id;

    await Promise.all([
      prisma.product.create({
        data: { companyId: empresaA, name: `${TERMINO} Producto`, price: 1000 },
      }),
      prisma.product.create({
        data: { companyId: empresaB, name: `${TERMINO} Producto`, price: 1000 },
      }),
    ]);
  });

  afterAll(async () => {
    // Se borra por ID exacto y en orden de dependencias.
    for (const id of [empresaA, empresaB]) {
      await prisma.product.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('cada empresa ve SOLO lo suyo aunque el texto sea idéntico', async () => {
    const [ra, rb] = await Promise.all([
      service.buscar(empresaA, { q: TERMINO }),
      service.buscar(empresaB, { q: TERMINO }),
    ]);

    const idsDe = (r: Awaited<ReturnType<SearchService['buscar']>>) =>
      r.grupos.flatMap((g) => g.resultados.map((x) => x.id));

    expect(idsDe(ra)).toContain(contactoA);
    expect(idsDe(ra)).not.toContain(contactoB);

    expect(idsDe(rb)).toContain(contactoB);
    expect(idsDe(rb)).not.toContain(contactoA);
  });

  it('cada empresa encuentra exactamente un contacto y un producto', async () => {
    const r = await service.buscar(empresaA, { q: TERMINO });

    const porTipo = Object.fromEntries(r.grupos.map((g) => [g.tipo, g.total]));
    expect(porTipo.contactos).toBe(1);
    expect(porTipo.productos).toBe(1);
    expect(r.total).toBe(2);
  });

  it('una empresa sin coincidencias devuelve cero grupos, no los de otra', async () => {
    const vacia = await prisma.company.create({
      data: { name: 'E2E Search Co Vacia' },
    });
    try {
      const r = await service.buscar(vacia.id, { q: TERMINO });

      expect(r.total).toBe(0);
      expect(r.grupos).toEqual([]);
    } finally {
      await prisma.company
        .delete({ where: { id: vacia.id } })
        .catch(() => undefined);
    }
  });

  it('un contacto archivado no aparece salvo que se pida la papelera', async () => {
    const archivado = await prisma.contact.create({
      data: {
        companyId: empresaA,
        phone: '+19990000003',
        name: `${TERMINO} Archivado`,
        archivedAt: new Date(),
      },
    });

    try {
      const sinPapelera = await service.buscar(empresaA, {
        q: `${TERMINO} Archivado`,
        tipos: ['contactos'],
      });
      expect(sinPapelera.total).toBe(0);

      const conPapelera = await service.buscar(empresaA, {
        q: `${TERMINO} Archivado`,
        tipos: ['contactos'],
        incluirPapelera: true,
      });
      expect(conPapelera.grupos[0].resultados[0]).toMatchObject({
        id: archivado.id,
        archivado: true,
      });
    } finally {
      await prisma.contact
        .delete({ where: { id: archivado.id } })
        .catch(() => undefined);
    }
  });
});
