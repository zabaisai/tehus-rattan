import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportacionDeProductosService } from '../src/modules/products/import/importacion.service';
import { mapearCabeceras } from '../src/modules/products/import/mapeo-columnas';
import { AlmacenamientoEnDirectorioCompartido } from '../src/modules/products/import/almacenamiento-importaciones';

/**
 * IMPORTACION DE CATALOGO — contra la base real.
 *
 * Lo que se comprueba es lo que un doble no demuestra: que los productos
 * quedan escritos, que el upsert por SKU no duplica, que cancelar para de
 * verdad, que reanudar no repite lo ya escrito y que el temporal se borra.
 *
 * Los archivos se GENERAN aqui; ninguno se sube al repositorio.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-IMP';

describe('Importación de catálogo (e2e, base real)', () => {
  /**
   * DOS INSTANCIAS, COMO EN PRODUCCION.
   *
   * `backend` recibe y guarda; `worker` lee y procesa. Cada una tiene su PROPIO
   * objeto de almacenamiento, igual que en el despliegue son procesos distintos,
   * y lo unico que comparten es la carpeta —el equivalente al volumen de Docker—.
   *
   * La version anterior usaba UN servicio y pasaba rutas absolutas, asi que no
   * podia detectar que el worker no encontraba el archivo del backend. Ese fallo
   * llego a staging y tumbo la importacion entera.
   */
  let almacenBackend: AlmacenamientoEnDirectorioCompartido;
  let almacenWorker: AlmacenamientoEnDirectorioCompartido;
  let servicio: ImportacionDeProductosService;
  let servicioWorker: ImportacionDeProductosService;

  let empresaA: string;
  let empresaB: string;
  let carpeta: string;
  let n = 0;

  /**
   * Genera el CSV y lo entrega AL ALMACENAMIENTO DEL BACKEND, que es lo que
   * hace multer en producción. Devuelve la CLAVE, nunca una ruta: si esto
   * devolviera una ruta, la prueba volvería a no poder ver el fallo de staging.
   */
  async function csv(filas: string[][], cabecera = 'Nombre,SKU,Precio') {
    const origen = path.join(carpeta, `origen-${n++}.csv`);
    const contenido = [cabecera, ...filas.map((f) => f.join(','))].join('\n');
    await fs.promises.writeFile(origen, contenido, 'utf8');
    const clave = await almacenBackend.guardar(origen, 'catalogo.csv');
    await fs.promises.unlink(origen).catch(() => undefined);
    return clave;
  }

  async function registrar(clave: string, companyId = empresaA) {
    const info = await fs.promises.stat(almacenBackend.rutaFisica(clave));
    const imp = await servicio.registrar(companyId, undefined, {
      nombre: 'catalogo.csv',
      tamaño: info.size,
      clave,
    });
    // El mapeo se fija siempre: en producción lo confirma una persona tras
    // ver la vista previa.
    const cabeceras = (await servicio.vistaPrevia(imp.id, companyId, 1))
      .cabeceras;
    await servicio.fijarMapeo(imp.id, companyId, mapearCabeceras(cabeceras));
    return imp;
  }

  beforeAll(async () => {
    carpeta = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'takto-e2e-imp-'),
    );

    // El equivalente al volumen compartido: dos almacenamientos INDEPENDIENTES
    // apuntando a la misma raíz. Ninguno conoce las rutas del otro; lo único
    // que viaja entre ellos es la clave.
    almacenBackend = new AlmacenamientoEnDirectorioCompartido(carpeta);
    almacenWorker = new AlmacenamientoEnDirectorioCompartido(carpeta);
    servicio = new ImportacionDeProductosService(
      prisma as unknown as PrismaService,
      almacenBackend,
    );
    servicioWorker = new ImportacionDeProductosService(
      prisma as unknown as PrismaService,
      almacenWorker,
    );

    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.productImport.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.product.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
    await fs.promises.rm(carpeta, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.productImport.deleteMany({ where: { companyId: empresaA } });
    await prisma.product.deleteMany({ where: { companyId: empresaA } });
  });

  // ── el camino feliz ──────────────────────────────────────────

  it('escribe los productos y cuenta lo que hizo', async () => {
    const ruta = await csv([
      ['Silla Nórdica', 'SKU-1', '250000'],
      ['Mesa Roble', 'SKU-2', '890000'],
    ]);
    const imp = await registrar(ruta);

    await servicioWorker.procesar(imp.id);

    const estado = await servicio.estado(imp.id, empresaA);
    expect(estado.status).toBe('COMPLETED');
    expect(estado.created).toBe(2);
    expect(estado.failed).toBe(0);
    expect(estado.porcentaje).toBe(100);

    const productos = await prisma.product.findMany({
      where: { companyId: empresaA },
      orderBy: { name: 'asc' },
    });
    expect(productos.map((p) => p.name)).toEqual([
      'Mesa Roble',
      'Silla Nórdica',
    ]);
    expect(Number(productos[1].price)).toBe(250000);
  });

  it('interpreta precios escritos como los escribe una persona', async () => {
    const ruta = await csv([
      ['A', 'S-A', '1.200.000'],
      ['B', 'S-B', '$ 890000'],
      // Entrecomillado: un precio con coma decimal dentro de un CSV separado
      // por comas es genuinamente ambiguo, y así es como lo exporta Excel.
      ['C', 'S-C', '"1200000,50"'],
    ]);
    const imp = await registrar(ruta);

    await servicioWorker.procesar(imp.id);

    const p = await prisma.product.findMany({
      where: { companyId: empresaA },
      orderBy: { name: 'asc' },
    });
    expect(Number(p[0].price)).toBe(1_200_000);
    expect(Number(p[1].price)).toBe(890_000);
    expect(Number(p[2].price)).toBe(1_200_000.5);
  });

  // ── upsert y deduplicación ───────────────────────────────────

  /**
   * El MISMO SKU no crea un producto nuevo: actualiza el que hay. Sin esto,
   * reimportar el catálogo actualizado lo duplica entero.
   */
  it('el mismo SKU ACTUALIZA en vez de duplicar', async () => {
    const primera = await registrar(await csv([['Silla', 'SKU-X', '100000']]));
    await servicioWorker.procesar(primera.id);

    const segunda = await registrar(
      await csv([['Silla renovada', 'SKU-X', '150000']]),
    );
    await servicioWorker.procesar(segunda.id);

    const productos = await prisma.product.findMany({
      where: { companyId: empresaA },
    });
    expect(productos).toHaveLength(1);
    expect(productos[0].name).toBe('Silla renovada');
    expect(Number(productos[0].price)).toBe(150000);

    const estado = await servicio.estado(segunda.id, empresaA);
    expect(estado.updated).toBe(1);
    expect(estado.created).toBe(0);
  });

  it('dos empresas pueden usar el MISMO SKU sin pisarse', async () => {
    const enA = await registrar(
      await csv([['Silla A', 'SKU-COMPARTIDO', '1']]),
    );
    await servicioWorker.procesar(enA.id);

    const rutaB = await csv([['Silla B', 'SKU-COMPARTIDO', '2']]);
    const enB = await registrar(rutaB, empresaB);
    await servicioWorker.procesar(enB.id);

    const a = await prisma.product.findFirst({
      where: { companyId: empresaA },
    });
    const b = await prisma.product.findFirst({
      where: { companyId: empresaB },
    });
    expect(a!.name).toBe('Silla A');
    expect(b!.name).toBe('Silla B');

    await prisma.product.deleteMany({ where: { companyId: empresaB } });
    await prisma.productImport.deleteMany({ where: { companyId: empresaB } });
  });

  // ── filas malas ──────────────────────────────────────────────

  it('una fila sin nombre se omite y se explica, sin abortar el archivo', async () => {
    // Abortar por una fila mala obligaría a arreglar el archivo y volver a
    // empezar desde cero.
    const ruta = await csv([
      ['Buena', 'SKU-1', '100'],
      ['', '', ''],
      ['Otra buena', 'SKU-2', '200'],
    ]);
    const imp = await registrar(ruta);

    await servicioWorker.procesar(imp.id);

    const estado = await servicio.estado(imp.id, empresaA);
    expect(estado.created).toBe(2);
    expect(estado.skipped).toBe(1);
    const incidencias = estado.issues as Array<{
      fila: number;
      motivo: string;
    }>;
    expect(incidencias.some((i) => /sin nombre/i.test(i.motivo))).toBe(true);
  });

  // ── cancelación ──────────────────────────────────────────────

  it('cancelar una PENDIENTE la cierra y borra el temporal', async () => {
    const ruta = await csv([['A', 'S-1', '1']]);
    const imp = await registrar(ruta);

    const r = await servicio.cancelar(imp.id, empresaA);

    expect(r.estado).toBe('CANCELLED');
    expect(await almacenBackend.existe(ruta)).toBe(false);
  });

  it('cancelar una EN CURSO pide parar, no miente diciendo que ya paró', async () => {
    const ruta = await csv([['A', 'S-1', '1']]);
    const imp = await registrar(ruta);
    await prisma.productImport.update({
      where: { id: imp.id },
      data: { status: 'RUNNING' },
    });

    const r = await servicio.cancelar(imp.id, empresaA);

    expect(r.estado).toBe('CANCELLING');
  });

  it('el worker respeta la cancelación a mitad del archivo', async () => {
    const filas = Array.from({ length: 900 }, (_, i) => [
      `P${i}`,
      `SKU-${i}`,
      '1000',
    ]);
    const ruta = await csv(filas);
    const imp = await registrar(ruta);
    // Se pide cancelar ANTES de arrancar: el lector lo ve en su primer control.
    await prisma.productImport.update({
      where: { id: imp.id },
      data: { status: 'CANCELLING' },
    });

    await servicioWorker.procesar(imp.id);

    const estado = await servicio.estado(imp.id, empresaA);
    expect(estado.status).toBe('CANCELLED');
    const escritos = await prisma.product.count({
      where: { companyId: empresaA },
    });
    expect(escritos).toBeLessThan(900);
  });

  // ── reanudación ──────────────────────────────────────────────

  /**
   * Un worker que muere a mitad no puede duplicar lo ya escrito al volver.
   */
  it('reanuda desde la última fila confirmada, sin repetir', async () => {
    const filas = Array.from({ length: 10 }, (_, i) => [
      `P${i}`,
      `SKU-${i}`,
      '1000',
    ]);
    const ruta = await csv(filas);
    const imp = await registrar(ruta);

    // Se simula que ya se escribieron las 4 primeras y el proceso murió.
    for (let i = 0; i < 4; i++) {
      await prisma.product.create({
        data: {
          companyId: empresaA,
          name: `P${i}`,
          sku: `SKU-${i}`,
          price: '1000',
          category: 'Sin categoría',
        },
      });
    }
    await prisma.productImport.update({
      where: { id: imp.id },
      data: { lastCommittedRow: 4, processedRows: 4, created: 4 },
    });

    await servicioWorker.procesar(imp.id);

    const total = await prisma.product.count({
      where: { companyId: empresaA },
    });
    // 10 en total, no 14: las 4 primeras no se volvieron a crear.
    expect(total).toBe(10);
  });

  // ── una sola importación por empresa ─────────────────────────

  it('no deja arrancar dos importaciones a la vez en la misma empresa', async () => {
    // Dos a la vez sobre el mismo catálogo compiten por los mismos SKU y el
    // resultado depende de quién gane la carrera.
    await registrar(await csv([['A', 'S-1', '1']]));

    const otra = await csv([['B', 'S-2', '2']]);
    const info = await fs.promises.stat(almacenBackend.rutaFisica(otra));
    await expect(
      servicio.registrar(empresaA, undefined, {
        nombre: 'otra.csv',
        tamaño: info.size,
        clave: otra,
      }),
    ).rejects.toThrow(/importación en curso/i);

    // Y el archivo rechazado NO se queda ocupando disco.
    expect(await almacenBackend.existe(otra)).toBe(false);
  });

  it('la misma clave de idempotencia no arranca dos importaciones', async () => {
    const clave = `${PREFIJO}-clave-${Date.now()}`;
    const r1 = await csv([['A', 'S-1', '1']]);
    const i1 = await fs.promises.stat(almacenBackend.rutaFisica(r1));
    const primera = await servicio.registrar(
      empresaA,
      undefined,
      { nombre: 'a.csv', tamaño: i1.size, clave: r1 },
      clave,
    );

    const r2 = await csv([['B', 'S-2', '2']]);
    const i2 = await fs.promises.stat(almacenBackend.rutaFisica(r2));
    const segunda = await servicio.registrar(
      empresaA,
      undefined,
      { nombre: 'b.csv', tamaño: i2.size, clave: r2 },
      clave,
    );

    expect(segunda.id).toBe(primera.id);
    expect(await almacenBackend.existe(r2)).toBe(false);
  });

  // ── limpieza y aislamiento ───────────────────────────────────

  it('el temporal se borra al terminar', async () => {
    const ruta = await csv([['A', 'S-1', '1']]);
    const imp = await registrar(ruta);

    await servicioWorker.procesar(imp.id);

    expect(await almacenBackend.existe(ruta)).toBe(false);
    const estado = await servicio.estado(imp.id, empresaA);
    expect(estado.tempPath).toBeNull();
  });

  it('el temporal se borra TAMBIÉN si la importación falla', async () => {
    const ruta = await csv([['A', 'S-1', '1']]);
    const imp = await registrar(ruta);
    // El archivo desaparece antes de procesar: la importación debe fallar
    // limpiamente y no dejar rastro.
    await almacenBackend.eliminar(ruta);

    await servicioWorker.procesar(imp.id);

    const estado = await servicio.estado(imp.id, empresaA);
    expect(estado.status).toBe('FAILED');
    expect(estado.errorMessage).toBeTruthy();
  });

  it('NO se puede ver la importación de otra empresa', async () => {
    const imp = await registrar(await csv([['A', 'S-1', '1']]));

    await expect(servicio.estado(imp.id, empresaB)).rejects.toThrow();
    await expect(servicio.cancelar(imp.id, empresaB)).rejects.toThrow();
  });

  it('los productos importados quedan SOLO en la empresa que importó', async () => {
    const imp = await registrar(await csv([['Exclusivo', 'S-EX', '1']]));
    await servicioWorker.procesar(imp.id);

    expect(
      await prisma.product.count({
        where: { companyId: empresaB, name: 'Exclusivo' },
      }),
    ).toBe(0);
  });
});
