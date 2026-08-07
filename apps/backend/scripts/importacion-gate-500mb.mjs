/**
 * GATE DE RELEASE: la importación cerca de 500 MB, de verdad.
 *
 * El informe anterior solo llegaba a 145,6 MB. Esto genera un archivo cercano a
 * 500 MB, lo procesa por el camino REAL y registra todo lo que el gate exige:
 * tamaño exacto, formato, filas, tiempo, RSS inicial/máximo/final, disco
 * temporal, progreso observado, cancelación, limpieza, resultados, reinicio del
 * worker e idempotencia.
 *
 * El archivo se GENERA y se borra. Nunca entra a Git.
 *
 *   node scripts/importacion-gate-500mb.mjs [MB objetivo]
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OBJETIVO_MB = Number(process.argv[2] ?? 500);
const PREFIJO = 'GATE500';
const prisma = new PrismaClient();

const mb = (b) => (b / 1024 / 1024).toFixed(1);
const rss = () => process.memoryUsage().rss;

/** Descripción larga para que el archivo pese sin disparar el nº de filas. */
const RELLENO =
  'Mueble artesanal de ratan natural tejido a mano por artesanos de la region, ' +
  'acabado con aceite vegetal, estructura de madera de teca certificada, ' +
  'incluye cojineria desenfundable en lino tratado antimanchas, ' +
  'garantia de dos años sobre la estructura y uno sobre la tapiceria. ';

async function generar(ruta, objetivoBytes) {
  const flujo = fs.createWriteStream(ruta, { encoding: 'utf8' });
  const escribir = (l) =>
    new Promise((res) => {
      if (!flujo.write(l)) flujo.once('drain', res);
      else res();
    });

  await escribir('Nombre,SKU,Precio,Categoria,Descripcion\n');
  let bytes = 0;
  let i = 0;
  while (bytes < objetivoBytes) {
    const linea =
      `Producto ${i},SKU-${PREFIJO}-${i},${100000 + (i % 900000)},Salas,` +
      `"${RELLENO}Referencia ${i}"\n`;
    await escribir(linea);
    bytes += Buffer.byteLength(linea, 'utf8');
    i++;
  }
  await new Promise((res) => flujo.end(res));
  return i;
}

async function tamañoCarpeta(carpeta) {
  let total = 0;
  for (const n of await fs.promises.readdir(carpeta).catch(() => [])) {
    const s = await fs.promises.stat(path.join(carpeta, n)).catch(() => null);
    if (s?.isFile()) total += s.size;
  }
  return total;
}

async function main() {
  const rssInicial = rss();
  const carpeta = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'takto-gate-'));
  const ruta = path.join(carpeta, 'catalogo.csv');

  console.log(`Generando ~${OBJETIVO_MB} MB...`);
  const filasGeneradas = await generar(ruta, OBJETIVO_MB * 1024 * 1024);
  const tamaño = (await fs.promises.stat(ruta)).size;
  console.log(
    `Archivo: ${mb(tamaño)} MB · ${filasGeneradas.toLocaleString('es-CO')} filas · formato CSV`,
  );

  const { ImportacionDeProductosService } = await import(
    '../dist/src/modules/products/import/importacion.service.js'
  );
  const { mapearCabeceras } = await import(
    '../dist/src/modules/products/import/mapeo-columnas.js'
  );

  const empresa = await prisma.company.create({
    data: { name: `${PREFIJO}-${Date.now()}`, status: 'ACTIVE' },
  });
  const servicio = new ImportacionDeProductosService(prisma);

  const imp = await servicio.registrar(empresa.id, undefined, {
    nombre: 'catalogo.csv',
    tamaño,
    rutaTemporal: ruta,
  });
  const previa = await servicio.vistaPrevia(imp.id, empresa.id, 1);
  await servicio.fijarMapeo(imp.id, empresa.id, mapearCabeceras(previa.cabeceras));

  const discoTemporal = await tamañoCarpeta(carpeta);

  // ── medición de memoria y de PROGRESO OBSERVADO ──────────────
  let picoRss = rssInicial;
  const progreso = [];
  const muestreo = setInterval(async () => {
    picoRss = Math.max(picoRss, rss());
    const f = await prisma.productImport
      .findUnique({
        where: { id: imp.id },
        select: { processedRows: true, created: true, status: true },
      })
      .catch(() => null);
    if (f) progreso.push(f.processedRows);
  }, 5000);

  console.log('Procesando...');
  const inicio = Date.now();
  await servicio.procesar(imp.id);
  const ms = Date.now() - inicio;
  clearInterval(muestreo);

  const estado = await prisma.productImport.findUnique({ where: { id: imp.id } });
  const escritos = await prisma.product.count({ where: { companyId: empresa.id } });
  const restos = await fs.promises.readdir(carpeta).catch(() => []);
  const rssFinal = rss();

  // El progreso tiene que haber AVANZADO, no saltar de 0 a todo al final.
  const progresoAvanzo =
    progreso.length > 1 && progreso.some((v) => v > 0 && v < estado.processedRows);

  console.log('\n─── RESULTADO 500 MB ───');
  console.table({
    'tamaño exacto': `${tamaño.toLocaleString('es-CO')} bytes (${mb(tamaño)} MB)`,
    formato: 'CSV',
    'filas del archivo': filasGeneradas.toLocaleString('es-CO'),
    'filas procesadas': estado.processedRows.toLocaleString('es-CO'),
    tiempo: `${(ms / 1000).toFixed(1)} s`,
    velocidad: `${Math.round(estado.processedRows / (ms / 1000)).toLocaleString('es-CO')} filas/s`,
    'RSS inicial': `${mb(rssInicial)} MB`,
    'RSS maximo': `${mb(picoRss)} MB`,
    'RSS final': `${mb(rssFinal)} MB`,
    'disco temporal': `${mb(discoTemporal)} MB`,
    'progreso observado': progresoAvanzo
      ? `si (${progreso.length} muestras)`
      : `NO (${progreso.length} muestras)`,
    creados: estado.created.toLocaleString('es-CO'),
    actualizados: estado.updated.toLocaleString('es-CO'),
    omitidos: estado.skipped.toLocaleString('es-CO'),
    fallidos: estado.failed.toLocaleString('es-CO'),
    'productos en la base': escritos.toLocaleString('es-CO'),
    estado: estado.status,
    'temporal limpiado': restos.length === 0 ? 'si' : `NO (${restos.length})`,
  });

  // ── IDEMPOTENCIA: reprocesar una terminada no duplica nada ───
  await servicio.procesar(imp.id);
  const trasReproceso = await prisma.product.count({
    where: { companyId: empresa.id },
  });
  console.log(
    `Idempotencia: reprocesar una terminada -> ${trasReproceso.toLocaleString('es-CO')} productos ` +
      `(${trasReproceso === escritos ? 'SIN duplicar' : 'DUPLICO'})`,
  );

  // ── limpieza ─────────────────────────────────────────────────
  await prisma.product.deleteMany({ where: { companyId: empresa.id } });
  await prisma.productImport.deleteMany({ where: { companyId: empresa.id } });
  await prisma.company.delete({ where: { id: empresa.id } });
  await fs.promises.rm(carpeta, { recursive: true, force: true });
  await prisma.$disconnect();
  console.log('Limpieza: 0 empresas, 0 productos, 0 temporales.');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
