import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportacionDeProductosService } from '../src/modules/products/import/importacion.service';
import { mapearCabeceras } from '../src/modules/products/import/mapeo-columnas';
import { AlmacenamientoEnDirectorioCompartido } from '../src/modules/products/import/almacenamiento-importaciones';

/**
 * IMPORTACIÓN DE CATÁLOGO CON TIPO DE ELEMENTO (Fase 2) — contra la base real.
 *
 * Lo que se comprueba: que la columna «Tipo de elemento» se reconoce y se
 * escribe (PRODUCT/SERVICE, en español o inglés, sin distinguir mayúsculas);
 * que un archivo SIN la columna crea PRODUCT y, al actualizar por SKU, NO
 * cambia el tipo que ya tenía el elemento; y que un valor no reconocido deja
 * la fila como fallida con un motivo legible, sin adivinar.
 *
 * Los archivos se GENERAN aquí; ninguno se sube al repositorio.
 * Datos con prefijo E2E-IMPTIPO, borrados al final por ID exacto.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-IMPTIPO';

describe('Importación de catálogo: tipo de elemento (e2e, base real)', () => {
  let almacen: AlmacenamientoEnDirectorioCompartido;
  let servicio: ImportacionDeProductosService;
  let empresa: string;
  let carpeta: string;
  let n = 0;

  async function csv(filas: string[][], cabecera: string) {
    const origen = path.join(carpeta, `origen-${n++}.csv`);
    const contenido = [cabecera, ...filas.map((f) => f.join(','))].join('\n');
    await fs.promises.writeFile(origen, contenido, 'utf8');
    const clave = await almacen.guardar(origen, 'catalogo.csv');
    await fs.promises.unlink(origen).catch(() => undefined);
    return clave;
  }

  async function importar(filas: string[][], cabecera: string) {
    const clave = await csv(filas, cabecera);
    const info = await fs.promises.stat(almacen.rutaFisica(clave));
    const imp = await servicio.registrar(empresa, undefined, {
      nombre: 'catalogo.csv',
      tamaño: info.size,
      clave,
    });
    const previa = await servicio.vistaPrevia(imp.id, empresa, 1);
    const mapeo = mapearCabeceras(previa.cabeceras);
    await servicio.fijarMapeo(imp.id, empresa, mapeo);
    await servicio.procesar(imp.id);
    return { imp, mapeo, estado: await servicio.estado(imp.id, empresa) };
  }

  beforeAll(async () => {
    carpeta = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'takto-e2e-imptipo-'),
    );
    almacen = new AlmacenamientoEnDirectorioCompartido(carpeta);
    servicio = new ImportacionDeProductosService(
      prisma as unknown as PrismaService,
      almacen,
    );
    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    empresa = a.id;
  });

  afterAll(async () => {
    await prisma.productImport.deleteMany({ where: { companyId: empresa } });
    await prisma.product.deleteMany({ where: { companyId: empresa } });
    await prisma.company.deleteMany({ where: { id: empresa } });
    await prisma.$disconnect();
    await fs.promises.rm(carpeta, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.productImport.deleteMany({ where: { companyId: empresa } });
    await prisma.product.deleteMany({ where: { companyId: empresa } });
  });

  const tipos = async () => {
    const filas = await prisma.product.findMany({
      where: { companyId: empresa },
      select: { sku: true, itemType: true, name: true },
      orderBy: { sku: 'asc' },
    });
    return Object.fromEntries(filas.map((f) => [f.sku, f.itemType]));
  };

  it('reconoce la columna «Tipo de elemento» y escribe PRODUCT/SERVICE (español, inglés, mayúsculas)', async () => {
    const { mapeo, estado } = await importar(
      [
        ['Silla', 'S-1', '100', 'Producto'],
        ['Consulta', 'S-2', '50', 'SERVICIO'],
        ['Mesa', 'S-3', '200', 'product'],
        ['Instalación', 'S-4', '80', 'Service'],
      ],
      'Nombre,SKU,Precio,Tipo de elemento',
    );
    expect(mapeo.campos.itemType).toBe(3);
    expect(mapeo.campos.category).toBeUndefined();
    expect(estado.status).toBe('COMPLETED');
    expect(estado.created).toBe(4);
    expect(estado.failed).toBe(0);
    expect(await tipos()).toEqual({
      'S-1': 'PRODUCT',
      'S-2': 'SERVICE',
      'S-3': 'PRODUCT',
      'S-4': 'SERVICE',
    });
  });

  it('sin la columna: todo se crea como PRODUCT (default) y la cabecera «Tipo» sigue siendo categoría', async () => {
    const { mapeo, estado } = await importar(
      [
        ['Silla', 'S-1', '100', 'Salas'],
        ['Mesa', 'S-2', '200', 'Comedores'],
      ],
      'Nombre,SKU,Precio,Tipo',
    );
    expect(mapeo.campos.category).toBe(3);
    expect(mapeo.campos.itemType).toBeUndefined();
    expect(estado.created).toBe(2);
    expect(await tipos()).toEqual({ 'S-1': 'PRODUCT', 'S-2': 'PRODUCT' });
    const cat = await prisma.product.findFirst({
      where: { companyId: empresa, sku: 'S-1' },
      select: { category: true },
    });
    expect(cat?.category).toBe('Salas');
  });

  it('un valor no reconocido deja la fila como FALLIDA con motivo legible; las demás se importan', async () => {
    const { imp, estado } = await importar(
      [
        ['Silla', 'S-1', '100', 'Producto'],
        ['Cosa', 'S-2', '10', 'Bien'],
        ['Consulta', 'S-3', '50', 'Servicio'],
      ],
      'Nombre,SKU,Precio,Item Type',
    );
    expect(estado.status).toBe('COMPLETED');
    expect(estado.created).toBe(2);
    expect(estado.failed).toBe(1);
    expect(estado.skipped).toBe(0);
    expect(await tipos()).toEqual({ 'S-1': 'PRODUCT', 'S-3': 'SERVICE' });
    const fila = await prisma.productImport.findUniqueOrThrow({
      where: { id: imp.id },
      select: { issues: true },
    });
    const incidencias = fila.issues as Array<{
      fila: number;
      motivo: string;
      nombre?: string;
    }>;
    expect(incidencias).toHaveLength(1);
    // Las filas se numeran sin la cabecera: la segunda fila de datos es la 2.
    expect(incidencias[0].fila).toBe(2);
    expect(incidencias[0].motivo).toContain('Tipo de elemento no reconocido');
    expect(incidencias[0].motivo).toContain('Bien');
    expect(incidencias[0].nombre).toBe('Cosa');
  });

  it('upsert por SKU: un archivo antiguo sin la columna NO cambia el tipo existente; uno con la columna sí', async () => {
    await importar(
      [['Consulta', 'S-2', '50', 'Servicio']],
      'Nombre,SKU,Precio,Tipo de elemento',
    );
    expect(await tipos()).toEqual({ 'S-2': 'SERVICE' });

    // Archivo antiguo (sin tipo): actualiza precio, respeta el tipo.
    const viejo = await importar(
      [['Consulta', 'S-2', '75']],
      'Nombre,SKU,Precio',
    );
    expect(viejo.estado.updated).toBe(1);
    expect(viejo.estado.created).toBe(0);
    expect(await tipos()).toEqual({ 'S-2': 'SERVICE' });
    const fila = await prisma.product.findFirst({
      where: { companyId: empresa, sku: 'S-2' },
      select: { price: true },
    });
    expect(Number(fila?.price)).toBe(75);

    // Celda vacía en la columna de tipo = no informado: tampoco cambia.
    const vacio = await importar(
      [['Consulta', 'S-2', '80', '']],
      'Nombre,SKU,Precio,Tipo de elemento',
    );
    expect(vacio.estado.updated).toBe(1);
    expect(await tipos()).toEqual({ 'S-2': 'SERVICE' });

    // Con la columna informada, sí cambia.
    const nuevo = await importar(
      [['Consulta', 'S-2', '80', 'Producto']],
      'Nombre,SKU,Precio,Tipo de elemento',
    );
    expect(nuevo.estado.updated).toBe(1);
    expect(await tipos()).toEqual({ 'S-2': 'PRODUCT' });
  });

  it('no deja archivos temporales al terminar', async () => {
    await importar(
      [['Silla', 'S-1', '100', 'Producto']],
      'Nombre,SKU,Precio,Tipo de elemento',
    );
    const restantes = await fs.promises.readdir(carpeta);
    expect(restantes.filter((f) => f.startsWith('origen-'))).toEqual([]);
  });
});
