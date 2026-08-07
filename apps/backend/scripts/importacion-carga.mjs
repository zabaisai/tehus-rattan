/**
 * PRUEBA DE CARGA de la importacion de catalogo.
 *
 * Genera un CSV grande, lo procesa por el camino real —streaming, lotes,
 * estado durable— y mide tamaño, filas, tiempo, MEMORIA MAXIMA, velocidad,
 * errores y uso de disco.
 *
 * La memoria es lo que de verdad se esta comprobando: con el lector anterior,
 * que hacia `load(buffer)`, el pico crecia con el archivo. Aqui tiene que
 * quedarse plano.
 *
 * El archivo se GENERA y se borra; nunca entra al repositorio.
 *
 *   node scripts/importacion-carga.mjs [filas]
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FILAS = Number(process.argv[2] ?? 100_000);
const PREFIJO = 'CARGA-IMP';
const prisma = new PrismaClient();

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

async function generarCsv(ruta, filas) {
  const flujo = fs.createWriteStream(ruta, { encoding: 'utf8' });
  const escribir = (linea) =>
    new Promise((res) => {
      if (!flujo.write(linea)) flujo.once('drain', res);
      else res();
    });

  await escribir('Nombre,SKU,Precio,Categoria,Descripcion\n');
  for (let i = 0; i < filas; i++) {
    await escribir(
      `Producto ${i},SKU-${PREFIJO}-${i},${100000 + (i % 900000)},Salas,` +
        `"Mueble de ratan tejido a mano, referencia ${i}"\n`,
    );
  }
  await new Promise((res) => flujo.end(res));
}

async function main() {
  const carpeta = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'takto-carga-'),
  );
  const ruta = path.join(carpeta, 'catalogo.csv');

  console.log(`Generando ${FILAS.toLocaleString('es-CO')} filas...`);
  await generarCsv(ruta, FILAS);
  const tamaño = (await fs.promises.stat(ruta)).size;
  console.log(`Archivo: ${mb(tamaño)} MB`);

  const empresa = await prisma.company.create({
    data: { name: `${PREFIJO}-${Date.now()}`, status: 'ACTIVE' },
  });

  // El servicio compilado: se mide el camino REAL, no una reimplementacion.
  const { ImportacionDeProductosService } = await import(
    '../dist/src/modules/products/import/importacion.service.js'
  );
  const { mapearCabeceras } = await import(
    '../dist/src/modules/products/import/mapeo-columnas.js'
  );

  const servicio = new ImportacionDeProductosService(prisma);
  const imp = await servicio.registrar(empresa.id, undefined, {
    nombre: 'catalogo.csv',
    tamaño,
    rutaTemporal: ruta,
  });
  const previa = await servicio.vistaPrevia(imp.id, empresa.id, 1);
  await servicio.fijarMapeo(imp.id, empresa.id, mapearCabeceras(previa.cabeceras));

  // Pico de memoria, muestreado mientras corre.
  let picoRss = 0;
  let picoHeap = 0;
  const muestreo = setInterval(() => {
    const m = process.memoryUsage();
    picoRss = Math.max(picoRss, m.rss);
    picoHeap = Math.max(picoHeap, m.heapUsed);
  }, 200);

  const inicio = Date.now();
  await servicio.procesar(imp.id);
  const ms = Date.now() - inicio;
  clearInterval(muestreo);

  const estado = await prisma.productImport.findUnique({ where: { id: imp.id } });
  const escritos = await prisma.product.count({
    where: { companyId: empresa.id },
  });

  const restos = await fs.promises.readdir(carpeta).catch(() => []);

  console.log('\n─── RESULTADO ───');
  console.table({
    'tamaño del archivo': `${mb(tamaño)} MB`,
    'filas del archivo': FILAS.toLocaleString('es-CO'),
    'filas procesadas': estado.processedRows.toLocaleString('es-CO'),
    creados: estado.created.toLocaleString('es-CO'),
    actualizados: estado.updated.toLocaleString('es-CO'),
    omitidos: estado.skipped.toLocaleString('es-CO'),
    fallidos: estado.failed.toLocaleString('es-CO'),
    'productos en la base': escritos.toLocaleString('es-CO'),
    estado: estado.status,
    tiempo: `${(ms / 1000).toFixed(1)} s`,
    velocidad: `${Math.round(estado.processedRows / (ms / 1000)).toLocaleString('es-CO')} filas/s`,
    'MEMORIA MAXIMA (RSS)': `${mb(picoRss)} MB`,
    'memoria maxima (heap)': `${mb(picoHeap)} MB`,
    'temporal borrado': restos.length === 0 ? 'sí' : `NO (${restos.length})`,
  });

  // Limpieza: ni empresa, ni productos, ni carpeta.
  await prisma.product.deleteMany({ where: { companyId: empresa.id } });
  await prisma.productImport.deleteMany({ where: { companyId: empresa.id } });
  await prisma.company.delete({ where: { id: empresa.id } });
  await fs.promises.rm(carpeta, { recursive: true, force: true });
  await prisma.$disconnect();

  console.log('\nLimpieza completada: 0 empresas, 0 productos y 0 temporales.');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
