/**
 * Cancelacion y REINICIO DEL WORKER a escala grande.
 *
 * Lo que el gate pide y la prueba de 500 MB no cubria: que cancelar a mitad de
 * un archivo enorme pare de verdad, y que un worker que muere y vuelve reanude
 * sin duplicar lo ya escrito.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const prisma = new PrismaClient();
const FILAS = 400000;

async function generar(ruta) {
  const f = fs.createWriteStream(ruta, { encoding: 'utf8' });
  const w = (l) => new Promise((r) => { if (!f.write(l)) f.once('drain', r); else r(); });
  await w('Nombre,SKU,Precio\n');
  for (let i = 0; i < FILAS; i++) await w(`Producto ${i},SKU-CANCEL-${i},${100000 + i}\n`);
  await new Promise((r) => f.end(r));
}

async function main() {
  const carpeta = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'takto-cancel-'));
  const ruta = path.join(carpeta, 'c.csv');
  await generar(ruta);
  const tamaño = (await fs.promises.stat(ruta)).size;
  console.log(`Archivo: ${(tamaño/1024/1024).toFixed(1)} MB, ${FILAS.toLocaleString('es-CO')} filas`);

  const { ImportacionDeProductosService } = await import('../dist/src/modules/products/import/importacion.service.js');
  const { mapearCabeceras } = await import('../dist/src/modules/products/import/mapeo-columnas.js');
  const empresa = await prisma.company.create({ data: { name: `CANCEL-${Date.now()}`, status: 'ACTIVE' } });
  const s = new ImportacionDeProductosService(prisma);

  // ── 1. CANCELACION a mitad ──────────────────────────────────
  const imp = await s.registrar(empresa.id, undefined, { nombre: 'c.csv', tamaño, rutaTemporal: ruta });
  const previa = await s.vistaPrevia(imp.id, empresa.id, 1);
  await s.fijarMapeo(imp.id, empresa.id, mapearCabeceras(previa.cabeceras));

  const corriendo = s.procesar(imp.id);
  await new Promise((r) => setTimeout(r, 12000));
  await prisma.productImport.update({ where: { id: imp.id }, data: { status: 'CANCELLING' } });
  const tCancel = Date.now();
  await corriendo;
  const msHastaParar = Date.now() - tCancel;

  const trasCancelar = await prisma.productImport.findUnique({ where: { id: imp.id } });
  const escritosTrasCancelar = await prisma.product.count({ where: { companyId: empresa.id } });
  console.log(`\nCANCELACION: estado=${trasCancelar.status} · paro en ${(msHastaParar/1000).toFixed(1)}s · ` +
    `${escritosTrasCancelar.toLocaleString('es-CO')} de ${FILAS.toLocaleString('es-CO')} escritos · ` +
    `temporal ${fs.existsSync(ruta) ? 'SIGUE' : 'borrado'}`);

  // ── 2. REINICIO DEL WORKER: reanudar sin duplicar ───────────
  await prisma.product.deleteMany({ where: { companyId: empresa.id } });
  await prisma.productImport.deleteMany({ where: { companyId: empresa.id } });
  const ruta2 = path.join(carpeta, 'c2.csv');
  await fs.promises.copyFile(path.join(carpeta, 'c.csv'), ruta2).catch(async () => { await generar(ruta2); });
  if (!fs.existsSync(ruta2)) await generar(ruta2);
  const t2 = (await fs.promises.stat(ruta2)).size;

  const imp2 = await s.registrar(empresa.id, undefined, { nombre: 'c2.csv', tamaño: t2, rutaTemporal: ruta2 });
  const p2 = await s.vistaPrevia(imp2.id, empresa.id, 1);
  await s.fijarMapeo(imp2.id, empresa.id, mapearCabeceras(p2.cabeceras));

  // El worker "muere": se para a mitad marcando CANCELLING, se rearma a
  // PENDING y se vuelve a procesar, que es lo que hace BullMQ al reintentar.
  const c2 = s.procesar(imp2.id);
  await new Promise((r) => setTimeout(r, 10000));
  await prisma.productImport.update({ where: { id: imp2.id }, data: { status: 'CANCELLING' } });
  await c2;
  const parcial = await prisma.productImport.findUnique({ where: { id: imp2.id } });
  const escritosParcial = await prisma.product.count({ where: { companyId: empresa.id } });
  console.log(`Worker cae con ${escritosParcial.toLocaleString('es-CO')} escritos (fila ${parcial.lastCommittedRow.toLocaleString('es-CO')})`);

  // Vuelve: se rearma y se reanuda desde lastCommittedRow.
  await generar(ruta2);
  await prisma.productImport.update({
    where: { id: imp2.id },
    data: { status: 'PENDING', tempPath: ruta2, finishedAt: null },
  });
  await s.procesar(imp2.id);

  const final = await prisma.productImport.findUnique({ where: { id: imp2.id } });
  const escritosFinal = await prisma.product.count({ where: { companyId: empresa.id } });
  const distintos = await prisma.product.findMany({ where: { companyId: empresa.id }, select: { sku: true } });
  const skusUnicos = new Set(distintos.map((d) => d.sku)).size;
  console.log(`REINICIO: estado=${final.status} · ${escritosFinal.toLocaleString('es-CO')} productos · ` +
    `${skusUnicos.toLocaleString('es-CO')} SKU unicos · ${escritosFinal === skusUnicos ? 'SIN duplicados' : 'HAY DUPLICADOS'}`);

  await prisma.product.deleteMany({ where: { companyId: empresa.id } });
  await prisma.productImport.deleteMany({ where: { companyId: empresa.id } });
  await prisma.company.delete({ where: { id: empresa.id } });
  await fs.promises.rm(carpeta, { recursive: true, force: true });
  await prisma.$disconnect();
  console.log('Limpieza completada.');
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
