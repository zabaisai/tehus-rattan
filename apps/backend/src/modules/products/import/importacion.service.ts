import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductImportStatus } from '@prisma/client';
import * as fs from 'fs';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FILAS_POR_LOTE,
  MAX_ERRORES_DETALLADOS,
  MAX_IMPORTACIONES_SIMULTANEAS,
} from '../products-import.constants';
import { FilaCruda, leerEnStreaming } from './lector-streaming';
import { MapeoDeColumnas, mapearCabeceras, CAMPOS } from './mapeo-columnas';

export interface IncidenciaDeFila {
  fila: number;
  motivo: string;
  nombre?: string;
}

/** Estados en los que la importacion ya termino y no se puede tocar. */
const TERMINALES: ProductImportStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

@Injectable()
export class ImportacionDeProductosService {
  private readonly logger = new Logger(ImportacionDeProductosService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Registra la importacion. NO la procesa: eso lo hace el worker.
   *
   * Una sola por empresa a la vez. Dos importaciones simultaneas sobre el
   * mismo catalogo compiten por los mismos SKU y el resultado depende de quien
   * gane la carrera.
   */
  async registrar(
    companyId: string,
    userId: string | undefined,
    archivo: { nombre: string; tamaño: number; rutaTemporal: string },
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const yaExiste = await this.prisma.productImport.findUnique({
        where: { idempotencyKey },
      });
      if (yaExiste) {
        // Reintentar la MISMA subida no arranca dos importaciones. El archivo
        // recien subido sobra: se borra para no dejarlo huerfano en disco.
        await this.borrarTemporal(archivo.rutaTemporal);
        if (yaExiste.companyId !== companyId) {
          throw new ConflictException(
            'Esa clave de importación ya se usó en otra empresa.',
          );
        }
        return yaExiste;
      }
    }

    const enCurso = await this.prisma.productImport.count({
      where: {
        companyId,
        status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] },
      },
    });
    if (enCurso >= MAX_IMPORTACIONES_SIMULTANEAS) {
      await this.borrarTemporal(archivo.rutaTemporal);
      throw new ConflictException(
        'Ya hay una importación en curso para esta empresa. Espera a que termine o cancélala.',
      );
    }

    return this.prisma.productImport.create({
      data: {
        companyId,
        createdById: userId,
        fileName: archivo.nombre.slice(0, 255),
        fileSize: archivo.tamaño,
        tempPath: archivo.rutaTemporal,
        status: 'PENDING',
        idempotencyKey: idempotencyKey || null,
      },
    });
  }

  /**
   * Vista previa: cabeceras, mapeo propuesto y unas pocas filas.
   *
   * Lee SOLO lo que enseña. Sin esto habria que lanzar la importacion entera
   * para descubrir que la columna del precio se llamaba distinto.
   */
  async vistaPrevia(id: string, companyId: string, filas = 5) {
    const imp = await this.buscar(id, companyId);
    if (!imp.tempPath || !fs.existsSync(imp.tempPath)) {
      throw new NotFoundException(
        'El archivo de esta importación ya no está disponible.',
      );
    }

    const muestra: FilaCruda[] = [];
    const { cabeceras } = await leerEnStreaming(
      imp.tempPath,
      imp.fileName,
      async (fila) => {
        if (muestra.length < filas) muestra.push(fila);
      },
      // Se corta en cuanto hay suficiente: una vista previa no recorre 200.000
      // filas para enseñar cinco.
      { cancelado: () => muestra.length >= filas },
    );

    const mapeo = mapearCabeceras(cabeceras);
    return {
      cabeceras,
      filas: muestra,
      mapeoPropuesto: mapeo,
      camposReconocidos: Object.keys(mapeo.campos),
      camposDisponibles: CAMPOS.map((c) => c.campo),
    };
  }

  /** Confirma el mapeo antes de procesar. */
  async fijarMapeo(id: string, companyId: string, mapeo: MapeoDeColumnas) {
    const imp = await this.buscar(id, companyId);
    if (imp.status !== 'PENDING') {
      throw new ConflictException(
        'Esta importación ya empezó; el mapeo no se puede cambiar.',
      );
    }
    return this.prisma.productImport.update({
      where: { id },
      data: { columnMapping: mapeo as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Cancela. NO es instantaneo.
   *
   * El worker esta a mitad de un lote; se le PIDE que pare y el estado pasa a
   * CANCELLING. Marcarla como cancelada aqui haria que la pantalla dijera
   * «cancelada» mientras siguen entrando productos.
   */
  async cancelar(id: string, companyId: string) {
    const imp = await this.buscar(id, companyId);
    if (TERMINALES.includes(imp.status)) {
      throw new ConflictException('Esta importación ya terminó.');
    }

    if (imp.status === 'PENDING') {
      // Todavia no la ha cogido nadie: se puede cerrar ya.
      await this.prisma.productImport.updateMany({
        where: { id, companyId, status: 'PENDING' },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
      await this.limpiarTemporal(id);
      return { estado: 'CANCELLED' as const };
    }

    await this.prisma.productImport.updateMany({
      where: { id, companyId, status: 'RUNNING' },
      data: { status: 'CANCELLING' },
    });
    return { estado: 'CANCELLING' as const };
  }

  async estado(id: string, companyId: string) {
    const imp = await this.buscar(id, companyId);
    const porcentaje =
      imp.totalRows > 0
        ? Math.min(100, Math.round((imp.processedRows / imp.totalRows) * 100))
        : imp.status === 'COMPLETED'
          ? 100
          : 0;
    return { ...imp, porcentaje };
  }

  listar(companyId: string, limite = 20) {
    return this.prisma.productImport.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limite, 1), 100),
    });
  }

  /**
   * PROCESA el archivo. Lo llama el worker.
   *
   * Reanudable: arranca en `lastCommittedRow + 1`. Ese contador se guarda
   * DESPUES de confirmar cada lote, nunca antes; si se guardara antes, un
   * reinicio a mitad se saltaria filas que nunca llegaron a escribirse.
   */
  async procesar(id: string): Promise<void> {
    const imp = await this.prisma.productImport.findUnique({ where: { id } });
    if (!imp) return;
    if (TERMINALES.includes(imp.status)) return;
    if (!imp.tempPath || !fs.existsSync(imp.tempPath)) {
      await this.terminar(id, 'FAILED', 'El archivo temporal ya no existe.');
      return;
    }

    // SOLO se pasa a RUNNING desde PENDING o desde un reintento de RUNNING.
    //
    // Un `update` a secas pisaba CANCELLING: si alguien cancelaba mientras el
    // job esperaba en la cola, el worker lo cogia despues y borraba la peticion
    // de cancelar sin enterarse. Quien pulso «cancelar» veia el catalogo
    // entrando igual.
    const arrancada = await this.prisma.productImport.updateMany({
      where: { id, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'RUNNING', startedAt: imp.startedAt ?? new Date() },
    });
    if (arrancada.count === 0) {
      // Estaba en CANCELLING: se cierra sin procesar nada.
      if (imp.status === 'CANCELLING') {
        await this.terminar(id, 'CANCELLED');
      }
      return;
    }

    const mapeo =
      (imp.columnMapping as unknown as MapeoDeColumnas | null) ?? null;
    const incidencias: IncidenciaDeFila[] = Array.isArray(imp.issues)
      ? (imp.issues as unknown as IncidenciaDeFila[])
      : [];

    let contadores = {
      created: imp.created,
      updated: imp.updated,
      skipped: imp.skipped,
      failed: imp.failed,
      processed: imp.processedRows,
    };
    let lote: Array<{ fila: number; datos: DatosDeProducto }> = [];
    let ultimaFila = imp.lastCommittedRow;

    try {
      const { cabeceras, cancelada } = await leerEnStreaming(
        imp.tempPath,
        imp.fileName,
        async (fila, numero) => {
          const activo = mapeo ?? mapearCabeceras(cabecerasDe(fila.length));
          const datos = this.interpretarFila(fila, activo, imp.companyId);

          if (!datos) {
            contadores.skipped++;
            contadores.processed++;
            if (incidencias.length < MAX_ERRORES_DETALLADOS) {
              incidencias.push({
                fila: numero,
                motivo: 'Sin nombre ni código',
              });
            }
            return;
          }

          lote.push({ fila: numero, datos });
          if (lote.length >= FILAS_POR_LOTE) {
            const r = await this.escribirLote(lote, incidencias);
            contadores = sumar(contadores, r, lote.length);
            ultimaFila = lote[lote.length - 1].fila;
            lote = [];
            await this.guardarProgreso(id, contadores, ultimaFila, incidencias);
          }
        },
        {
          desdeFila: imp.lastCommittedRow + 1,
          cancelado: () => this.pidieronCancelar(id),
        },
      );

      // El ultimo lote, que casi nunca llega a estar completo.
      if (lote.length > 0) {
        const r = await this.escribirLote(lote, incidencias);
        contadores = sumar(contadores, r, lote.length);
        ultimaFila = lote[lote.length - 1].fila;
        await this.guardarProgreso(id, contadores, ultimaFila, incidencias);
      }

      void cabeceras;

      await this.terminar(id, cancelada ? 'CANCELLED' : 'COMPLETED');
    } catch (error) {
      const mensaje =
        error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(`Importación ${id} falló: ${mensaje}`);
      await this.terminar(id, 'FAILED', mensaje);
    }
  }

  /**
   * Escribe un lote. UPSERT por SKU dentro de la empresa.
   *
   * Un fallo de una fila NO aborta el archivo: se cuenta, se explica y se
   * sigue. Abortar por una fila mala obligaria a arreglar el archivo y volver
   * a empezar desde cero.
   */
  /**
   * Escribe un lote. UPSERT por SKU dentro de la empresa.
   *
   * UNA consulta para TODO el lote, no una por fila. Con `findFirst` por
   * producto, quinientas filas eran mil viajes a la base y la importacion iba
   * a trescientas filas por segundo: un catalogo de cien mil tardaba cinco
   * minutos solo en preguntar.
   *
   * Un fallo de una fila NO aborta el archivo: se cuenta, se explica y se
   * sigue. Abortar por una fila mala obligaria a arreglar el archivo y volver
   * a empezar desde cero.
   */
  private async escribirLote(
    lote: Array<{ fila: number; datos: DatosDeProducto }>,
    incidencias: IncidenciaDeFila[],
  ): Promise<{ created: number; updated: number; failed: number }> {
    if (lote.length === 0) return { created: 0, updated: 0, failed: 0 };

    const companyId = lote[0].datos.companyId;
    const skus = [
      ...new Set(lote.map((l) => l.datos.sku).filter(Boolean)),
    ] as string[];

    // La deduplicacion es POR EMPRESA: dos empresas pueden tener el mismo SKU
    // sin pisarse, que es justo lo que un catalogo compartido rompe.
    const existentes = skus.length
      ? await this.prisma.product.findMany({
          where: { companyId, sku: { in: skus } },
          select: { id: true, sku: true },
        })
      : [];
    const porSku = new Map(existentes.map((p) => [p.sku!, p.id]));

    // Dentro del MISMO archivo puede repetirse un SKU. Gana la ultima
    // aparicion, que es lo que espera quien corrige una fila mas abajo.
    const nuevos: DatosDeProducto[] = [];
    const vistos = new Set<string>();
    const actualizaciones: Array<{
      id: string;
      datos: DatosDeProducto;
      fila: number;
    }> = [];

    for (const { fila, datos } of lote) {
      const id = datos.sku ? porSku.get(datos.sku) : undefined;
      if (id) {
        actualizaciones.push({ id, datos, fila });
      } else if (datos.sku && vistos.has(datos.sku)) {
        // Repetido dentro del lote y todavia sin id: se deja para el siguiente
        // lote en vez de crear dos filas con el mismo SKU.
        actualizaciones.push({ id: '', datos, fila });
      } else {
        if (datos.sku) vistos.add(datos.sku);
        nuevos.push(datos);
      }
    }

    let created = 0;
    let updated = 0;
    let failed = 0;

    if (nuevos.length > 0) {
      try {
        const r = await this.prisma.product.createMany({ data: nuevos });
        created += r.count;
      } catch {
        // Si el lote entero falla, se reintenta fila a fila para no perder las
        // buenas por culpa de una mala.
        for (const datos of nuevos) {
          try {
            await this.prisma.product.create({ data: datos });
            created++;
          } catch {
            failed++;
            this.anotar(
              incidencias,
              0,
              'No se pudo guardar el producto',
              datos.name,
            );
          }
        }
      }
    }

    for (const { id, datos, fila } of actualizaciones) {
      try {
        if (!id) {
          // SKU repetido dentro del lote: se resuelve ahora contra la base,
          // donde la primera aparicion ya existe.
          const yaEsta = await this.prisma.product.findFirst({
            where: { companyId, sku: datos.sku },
            select: { id: true },
          });
          if (!yaEsta) {
            await this.prisma.product.create({ data: datos });
            created++;
            continue;
          }
          await this.actualizar(yaEsta.id, datos);
          updated++;
          continue;
        }
        await this.actualizar(id, datos);
        updated++;
      } catch {
        failed++;
        this.anotar(
          incidencias,
          fila,
          'No se pudo actualizar el producto',
          datos.name,
        );
      }
    }

    return { created, updated, failed };
  }

  private actualizar(id: string, datos: DatosDeProducto) {
    return this.prisma.product.update({
      where: { id },
      data: {
        name: datos.name,
        price: datos.price,
        ...(datos.category ? { category: datos.category } : {}),
        ...(datos.description ? { description: datos.description } : {}),
        ...(datos.code ? { code: datos.code } : {}),
        ...(datos.stock !== undefined ? { stock: datos.stock } : {}),
      },
    });
  }

  private anotar(
    incidencias: IncidenciaDeFila[],
    fila: number,
    motivo: string,
    nombre?: string,
  ): void {
    if (incidencias.length < MAX_ERRORES_DETALLADOS) {
      incidencias.push({ fila, motivo, nombre });
    }
  }

  private interpretarFila(
    fila: FilaCruda,
    mapeo: MapeoDeColumnas,
    companyId: string,
  ): DatosDeProducto | null {
    const leer = (campo: string): string => {
      const i = mapeo.campos[campo];
      return i === undefined ? '' : (fila[i] ?? '').trim();
    };

    const name = leer('name') || leer('code') || leer('sku');
    if (!name) return null;

    return {
      companyId,
      name: name.slice(0, 300),
      price: interpretarPrecio(leer('price')),
      category: leer('category') || 'Sin categoría',
      description: leer('description') || undefined,
      code: leer('code') || undefined,
      sku: leer('sku') || undefined,
      stock: leer('stock') ? interpretarEntero(leer('stock')) : undefined,
    };
  }

  private async guardarProgreso(
    id: string,
    c: {
      created: number;
      updated: number;
      skipped: number;
      failed: number;
      processed: number;
    },
    ultimaFila: number,
    incidencias: IncidenciaDeFila[],
  ): Promise<void> {
    await this.prisma.productImport.update({
      where: { id },
      data: {
        created: c.created,
        updated: c.updated,
        skipped: c.skipped,
        failed: c.failed,
        processedRows: c.processed,
        // DESPUES de escribir el lote, nunca antes.
        lastCommittedRow: ultimaFila,
        totalRows: Math.max(c.processed, ultimaFila),
        issues: incidencias as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async pidieronCancelar(id: string): Promise<boolean> {
    const f = await this.prisma.productImport.findUnique({
      where: { id },
      select: { status: true },
    });
    return f?.status === 'CANCELLING';
  }

  private async terminar(
    id: string,
    status: ProductImportStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.productImport.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: errorMessage ?? null,
      },
    });
    // El temporal se borra pase lo que pase: un archivo de 200 MB por
    // importacion fallida llena el disco en una tarde.
    await this.limpiarTemporal(id);
  }

  private async limpiarTemporal(id: string): Promise<void> {
    const f = await this.prisma.productImport.findUnique({
      where: { id },
      select: { tempPath: true },
    });
    if (!f?.tempPath) return;
    await this.borrarTemporal(f.tempPath);
    await this.prisma.productImport
      .update({ where: { id }, data: { tempPath: null } })
      .catch(() => undefined);
  }

  private async borrarTemporal(ruta: string): Promise<void> {
    await fs.promises.unlink(ruta).catch(() => undefined);
  }

  private async buscar(id: string, companyId: string) {
    const imp = await this.prisma.productImport.findFirst({
      where: { id, companyId },
    });
    if (!imp) throw new NotFoundException('Importación no encontrada');
    return imp;
  }
}

interface DatosDeProducto {
  companyId: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  code?: string;
  sku?: string;
  stock?: number;
}

function sumar(
  c: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    processed: number;
  },
  r: { created: number; updated: number; failed: number },
  procesadas: number,
) {
  return {
    created: c.created + r.created,
    updated: c.updated + r.updated,
    skipped: c.skipped,
    failed: c.failed + r.failed,
    processed: c.processed + procesadas,
  };
}

/** Cabeceras de relleno cuando el archivo no trae mapeo confirmado. */
function cabecerasDe(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `col${i}`);
}

/**
 * Un precio escrito por una persona.
 *
 * "1.200.000", "1,200,000", "$ 1200000" y "1200000,50" son todos precios
 * validos en un catalogo real. Rechazarlos por formato dejaria fuera medio
 * archivo.
 */
export function interpretarPrecio(crudo: string): number {
  if (!crudo) return 0;
  let s = crudo.replace(/[^\d.,-]/g, '');
  if (!s) return 0;

  const punto = s.lastIndexOf('.');
  const coma = s.lastIndexOf(',');

  if (punto >= 0 && coma >= 0) {
    // El ultimo separador es el decimal; el otro son miles.
    s =
      coma > punto
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (coma >= 0) {
    const partes = s.split(',');
    const ultima = partes[partes.length - 1];
    // "1,200" con tres cifras detras son miles, no decimales.
    s =
      partes.length > 2 || ultima.length === 3
        ? s.replace(/,/g, '')
        : s.replace(',', '.');
  } else if (punto >= 0) {
    const partes = s.split('.');
    const ultima = partes[partes.length - 1];
    if (partes.length > 2 || ultima.length === 3) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function interpretarEntero(crudo: string): number {
  const n = Number(crudo.replace(/[^\d-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export type { MapeoDeColumnas };
