import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES,
  FILE_TOO_LARGE_MESSAGE,
  MAX_PRODUCT_IMPORT_ROWS,
  TOO_MANY_ROWS_MESSAGE,
  PRODUCT_IMPORT_BATCH_SIZE,
  PRODUCT_IMPORT_PREVIEW_LIMIT,
  MAX_EMBEDDED_IMAGE_SIZE_BYTES,
  MAX_TOTAL_EMBEDDED_IMAGES_BYTES,
} from './products-import.constants';

export interface ImportIssue {
  rowNumber: number;
  reason: string;
  rawName?: string;
}

export interface ImportSummary {
  totalRows: number;
  created: number;
  skipped: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  products: Array<{
    id: string;
    name: string;
    category: string | null;
    price: number;
  }>;
}

export interface UploadedExcelFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

interface RawRow {
  name?: string;
  category?: string;
  price?: unknown;
  imageUrl?: string;
  code?: string;
  sku?: string;
  stock?: unknown;
  description?: string;
  extras: Array<{ label: string; value: string }>;
}

const FIELD_ALIASES: Array<{
  field: keyof Omit<RawRow, 'extras'>;
  aliases: string[];
}> = [
  {
    field: 'name',
    aliases: [
      'nombre',
      'producto',
      'referencia',
      'item',
      'articulo',
      'descripcion corta',
    ],
  },
  {
    field: 'category',
    aliases: ['categoria', 'linea', 'tipo', 'familia', 'coleccion'],
  },
  {
    field: 'price',
    aliases: [
      'precio',
      'valor',
      'precio base',
      'valor unitario',
      'precio unitario',
      'precio venta',
      'venta',
    ],
  },
  {
    field: 'imageUrl',
    aliases: [
      'imagen',
      'foto',
      'url imagen',
      'image',
      'imageurl',
      'link imagen',
      'fotografia',
    ],
  },
  { field: 'code', aliases: ['codigo', 'code', 'referencia', 'ref'] },
  { field: 'sku', aliases: ['sku', 'referencia interna', 'sku interno'] },
  { field: 'stock', aliases: ['stock', 'cantidad', 'inventario', 'unidades'] },
  {
    field: 'description',
    aliases: ['descripcion', 'detalle', 'observaciones', 'notas'],
  },
];

/**
 * `.xlsm` NO entra. Es el formato de Excel CON MACROS.
 *
 * Se aceptaba, y aceptarlo significa que el producto recibe y guarda en disco
 * archivos con codigo ejecutable dentro. Aqui nadie ejecuta esas macros —solo
 * se leen celdas—, pero el archivo queda almacenado y acaba descargandose en
 * el equipo de alguien, donde Excel si pregunta si quiere habilitarlas. No hay
 * ninguna razon para aceptarlo: un catalogo de productos son datos, y los
 * datos se guardan igual de bien en `.xlsx` o `.csv`.
 */
const EXTENSIONES_PERMITIDAS = ['.xlsx', '.csv'];

/** Formatos que se rechazan con una explicacion propia, no con un genérico. */
const RECHAZOS_EXPLICADOS: Record<string, string> = {
  '.xlsm':
    'Los archivos .xlsm llevan macros y no se aceptan. Abre el archivo en Excel y guárdalo como .xlsx («Libro de Excel») para importarlo.',
  '.xlsb':
    'El formato binario .xlsb no es compatible. Guarda el archivo como .xlsx e inténtalo de nuevo.',
  '.xls':
    'El formato .xls (Excel 97-2003) no es compatible. Guarda el archivo como .xlsx desde Excel e intenta de nuevo.',
  '.xltm':
    'Las plantillas con macros (.xltm) no se aceptan. Guarda el archivo como .xlsx para importarlo.',
};

/**
 * Convierte a texto SOLO lo que tiene una representacion legible.
 *
 * `String(valor)` sobre un objeto produce "[object Object]", y una celda de
 * Excel puede traer objetos: una formula con error, un hipervinculo raro, un
 * texto enriquecido con una forma que no esperabamos. Sin este filtro, esa
 * cadena acababa siendo el NOMBRE de un producto en el catalogo del cliente.
 */
function textoPlano(valor: unknown): string {
  if (typeof valor === 'string') return sanearFormula(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  return '';
}

/**
 * Neutraliza la inyeccion de formulas.
 *
 * Una celda que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro
 * la interpreta Excel como formula CUANDO SE ABRE el archivo, no cuando se
 * escribe. Si ese texto entra como nombre de producto y despues sale en una
 * exportacion, quien abra ese CSV ejecuta lo que otro escribio —incluido
 * `=cmd|...`—, y el producto habria sido el mensajero.
 *
 * Se antepone un apostrofo, que es la forma estandar de decir «esto es texto»:
 * el valor se sigue leyendo igual y deja de ser ejecutable.
 */
export function sanearFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

interface ColumnMap {
  fields: Partial<Record<keyof Omit<RawRow, 'extras'>, number>>;
  unclaimed: Array<{ col: number; label: string }>;
}

interface EmbeddedImage {
  extension: string;
  buffer: Buffer;
}

interface PendingProduct {
  rowNumber: number;
  name: string;
  data: {
    companyId: string;
    name: string;
    category: string;
    price: number;
    stock: number;
    code: string | undefined;
    sku: string | undefined;
    description: string | undefined;
    imageUrl: string | undefined;
  };
}

@Injectable()
export class ProductsImportService {
  constructor(private prisma: PrismaService) {}

  async importFromExcel(
    companyId: string,
    file: UploadedExcelFile | undefined,
    baseUrl: string,
  ): Promise<ImportSummary> {
    this.validateFile(file);

    const esCsv = path.extname(file!.originalname).toLowerCase() === '.csv';

    const workbook = new ExcelJS.Workbook();
    try {
      if (esCsv) {
        // Un CSV no es un libro: se lee como una hoja unica. `Readable.from`
        // evita escribirlo antes a disco solo para poder leerlo.
        await workbook.csv.read(Readable.from(file!.buffer.toString('utf8')));
      } else {
        // exceljs bundles its own Buffer typing, incompatible with this project's
        // @types/node at the type level only (runtime accepts a plain Buffer fine).
        await workbook.xlsx.load(Buffer.from(file!.buffer) as any);
      }
    } catch {
      throw new BadRequestException(
        esCsv
          ? 'No se pudo leer el archivo. Verifica que sea un CSV válido y esté codificado en UTF-8.'
          : 'No se pudo leer el archivo. Verifica que sea un Excel .xlsx válido y no esté dañado.',
      );
    }

    if (!esCsv) this.rechazarSiTieneMacros(workbook);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException(
        'El Excel no tiene ninguna hoja con datos.',
      );
    }

    const columnMap = this.mapColumns(worksheet.getRow(1));
    if (
      columnMap.fields.name === undefined &&
      columnMap.fields.code === undefined &&
      columnMap.fields.sku === undefined
    ) {
      throw new BadRequestException(
        'No se detectó ninguna columna de nombre, código o SKU en el Excel.',
      );
    }

    const lastRow = worksheet.actualRowCount;
    const dataRowCount = Math.max(0, lastRow - 1);
    if (dataRowCount > MAX_PRODUCT_IMPORT_ROWS) {
      throw new BadRequestException(TOO_MANY_ROWS_MESSAGE);
    }

    const { images, imagesTruncated } = this.indexEmbeddedImages(
      workbook,
      worksheet,
    );
    const existing = await this.prisma.product.findMany({
      where: { companyId },
      select: { sku: true, code: true, name: true, category: true },
    });

    const seenSku = new Set(
      existing.filter((p) => p.sku).map((p) => p.sku!.trim().toLowerCase()),
    );
    const seenCode = new Set(
      existing.filter((p) => p.code).map((p) => p.code!.trim().toLowerCase()),
    );
    const seenNameCategory = new Set(
      existing.map(
        (p) =>
          `${p.name.trim().toLowerCase()}|${(p.category ?? '').trim().toLowerCase()}`,
      ),
    );

    const summary: ImportSummary = {
      totalRows: 0,
      created: 0,
      skipped: 0,
      warnings: [],
      errors: [],
      products: [],
    };

    if (imagesTruncated) {
      summary.warnings.push({
        rowNumber: 0,
        reason:
          'Se alcanzó el límite de imágenes embebidas procesadas; algunas imágenes fueron omitidas',
      });
    }

    const uploadsDir = path.join(
      process.cwd(),
      'uploads',
      'products',
      companyId,
    );

    // Rows are validated and deduplicated here (cheap, synchronous, in
    // memory) and queued; the actual product.create() calls are flushed in
    // bounded concurrent chunks by flushPendingBatch rather than one fully
    // sequential await per row.
    let pending: PendingProduct[] = [];

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      if (this.isRowEmpty(row)) continue;

      summary.totalRows++;
      const raw = this.extractRowValues(row, columnMap);

      const name = raw.name?.trim() || raw.code?.trim() || raw.sku?.trim();
      if (!name) {
        summary.skipped++;
        summary.errors.push({ rowNumber, reason: 'Sin nombre' });
        continue;
      }

      const category = raw.category?.trim() || 'Sin categoría';
      const { value: price, warning: priceWarning } = this.parsePrice(
        raw.price,
      );
      if (priceWarning) {
        summary.warnings.push({
          rowNumber,
          reason: priceWarning,
          rawName: name,
        });
      }

      const stock = this.parseStock(raw.stock);
      const skuKey = raw.sku?.trim().toLowerCase();
      const codeKey = raw.code?.trim().toLowerCase();
      const nameCategoryKey = `${name.trim().toLowerCase()}|${category.trim().toLowerCase()}`;

      const isDuplicate =
        (!!skuKey && seenSku.has(skuKey)) ||
        (!!codeKey && seenCode.has(codeKey)) ||
        (!skuKey && !codeKey && seenNameCategory.has(nameCategoryKey));

      if (isDuplicate) {
        summary.skipped++;
        summary.warnings.push({
          rowNumber,
          reason: 'Producto duplicado',
          rawName: name,
        });
        continue;
      }

      // Reserve the dedup keys now, synchronously — before this row's
      // product.create() has even been queued, let alone awaited — so an
      // in-batch duplicate later in the same file is still caught correctly
      // once creates start running concurrently.
      if (skuKey) seenSku.add(skuKey);
      if (codeKey) seenCode.add(codeKey);
      seenNameCategory.add(nameCategoryKey);

      let imageUrl: string | undefined;
      const urlValue = raw.imageUrl?.trim();
      if (urlValue && /^https?:\/\//i.test(urlValue)) {
        imageUrl = urlValue;
      } else {
        const embedded = images.get(rowNumber - 1);
        if (embedded) {
          if (embedded.buffer.length > MAX_EMBEDDED_IMAGE_SIZE_BYTES) {
            summary.warnings.push({
              rowNumber,
              reason: 'Imagen embebida demasiado grande, se omitió',
              rawName: name,
            });
          } else {
            try {
              imageUrl = this.saveEmbeddedImage(
                embedded,
                uploadsDir,
                companyId,
                baseUrl,
              );
            } catch {
              summary.warnings.push({
                rowNumber,
                reason: 'No se pudo guardar la imagen embebida',
                rawName: name,
              });
            }
          }
        }
      }

      const description = this.buildDescription(raw);

      pending.push({
        rowNumber,
        name,
        data: {
          companyId,
          name,
          category,
          price,
          stock,
          code: raw.code?.trim() || undefined,
          sku: raw.sku?.trim() || undefined,
          description: description || undefined,
          imageUrl,
        },
      });

      if (pending.length >= PRODUCT_IMPORT_BATCH_SIZE) {
        await this.flushPendingBatch(pending, summary);
        pending = [];
      }
    }

    if (pending.length > 0) {
      await this.flushPendingBatch(pending, summary);
    }

    return summary;
  }

  private async flushPendingBatch(
    batch: PendingProduct[],
    summary: ImportSummary,
  ): Promise<void> {
    const results = await Promise.allSettled(
      batch.map((item) => this.prisma.product.create({ data: item.data })),
    );

    results.forEach((result, index) => {
      const item = batch[index];
      if (result.status === 'fulfilled') {
        summary.created++;
        if (summary.products.length < PRODUCT_IMPORT_PREVIEW_LIMIT) {
          summary.products.push({
            id: result.value.id,
            name: result.value.name,
            category: result.value.category,
            price: result.value.price,
          });
        }
      } else {
        // A single row failing to save (e.g. a transient DB error) must not
        // abort the rest of the file — report it and move on.
        summary.skipped++;
        summary.errors.push({
          rowNumber: item.rowNumber,
          reason: 'No se pudo guardar el producto',
          rawName: item.name,
        });
      }
    });
  }

  private validateFile(file: UploadedExcelFile | undefined): void {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('El archivo es requerido');
    }

    const ext = path.extname(file.originalname).toLowerCase();

    const explicacion = RECHAZOS_EXPLICADOS[ext];
    if (explicacion) throw new BadRequestException(explicacion);

    if (!EXTENSIONES_PERMITIDAS.includes(ext)) {
      throw new BadRequestException(
        `Formato de archivo no permitido. Usa ${EXTENSIONES_PERMITIDAS.join(' o ')}.`,
      );
    }
    if (file.size > MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES) {
      throw new BadRequestException(FILE_TOO_LARGE_MESSAGE);
    }

    // La extension la pone quien sube el archivo. Un `.xlsm` renombrado a
    // `.xlsx` pasaria el filtro de arriba, asi que ademas se mira la FIRMA: un
    // .xlsx es un ZIP y empieza por "PK". Lo que distingue a un .xlsm de un
    // .xlsx esta dentro del ZIP —el `vbaProject.bin`—, y eso se comprueba al
    // abrirlo, no aqui; esto solo descarta lo que ni siquiera es un ZIP.
    if (ext === '.xlsx' && !this.pareceZip(file.buffer)) {
      throw new BadRequestException(
        'El archivo no parece un .xlsx válido. Vuelve a guardarlo desde Excel como «Libro de Excel».',
      );
    }
  }

  private pareceZip(buffer: Buffer): boolean {
    return (
      buffer.length >= 2 &&
      buffer[0] === 0x50 /* P */ &&
      buffer[1] === 0x4b /* K */
    );
  }

  /**
   * Un `.xlsx` legitimo no lleva proyecto de VBA. Si el libro trae uno, el
   * archivo es un `.xlsm` con la extension cambiada.
   */
  private rechazarSiTieneMacros(workbook: ExcelJS.Workbook): void {
    // exceljs no expone el ZIP, pero conserva el proyecto de VBA cuando el
    // libro lo trae. Si esta ahi, el archivo es un .xlsm con la extension
    // cambiada, por descuido o a proposito.
    const vba = (workbook as unknown as { vbaProject?: unknown }).vbaProject;
    if (vba) {
      throw new BadRequestException(
        'El archivo contiene macros. Guárdalo como .xlsx sin macros para importarlo.',
      );
    }
  }

  private normalizeHeader(value: string): string {
    const COMBINING_DIACRITICS = /[̀-ͯ]/g;
    return value
      .normalize('NFD')
      .replace(COMBINING_DIACRITICS, '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private mapColumns(headerRow: ExcelJS.Row): ColumnMap {
    const headers: Array<{
      col: number;
      normalized: string;
      original: string;
    }> = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const original = this.cellToString(cell).trim();
      const normalized = this.normalizeHeader(original);
      if (normalized) headers.push({ col: colNumber, normalized, original });
    });

    const claimed = new Set<number>();
    const fields: ColumnMap['fields'] = {};

    for (const { field, aliases } of FIELD_ALIASES) {
      const match = headers.find(
        (h) => !claimed.has(h.col) && aliases.includes(h.normalized),
      );
      if (match) {
        fields[field] = match.col;
        claimed.add(match.col);
      }
    }

    const unclaimed = headers
      .filter((h) => !claimed.has(h.col))
      .map((h) => ({ col: h.col, label: h.original }));

    return { fields, unclaimed };
  }

  private cellToString(cell: ExcelJS.Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const obj = value as unknown as Record<string, unknown>;
      if (Array.isArray((obj as any).richText)) {
        return (obj as any).richText.map((r: any) => r.text ?? '').join('');
      }
      if ('text' in obj || 'hyperlink' in obj) {
        return textoPlano(obj.text ?? obj.hyperlink);
      }
      if ('result' in obj) {
        // Una formula puede devolver un objeto de error de Excel. Escribirlo
        // como "[object Object]" lo convertiria en el nombre de un producto.
        return textoPlano(obj.result);
      }
      return '';
    }
    return textoPlano(value);
  }

  private extractRowValues(row: ExcelJS.Row, columnMap: ColumnMap): RawRow {
    const raw: RawRow = { extras: [] };
    const { fields, unclaimed } = columnMap;

    if (fields.name !== undefined)
      raw.name = this.cellToString(row.getCell(fields.name));
    if (fields.category !== undefined)
      raw.category = this.cellToString(row.getCell(fields.category));
    if (fields.price !== undefined) raw.price = row.getCell(fields.price).value;
    if (fields.imageUrl !== undefined)
      raw.imageUrl = this.cellToString(row.getCell(fields.imageUrl));
    if (fields.code !== undefined)
      raw.code = this.cellToString(row.getCell(fields.code));
    if (fields.sku !== undefined)
      raw.sku = this.cellToString(row.getCell(fields.sku));
    if (fields.stock !== undefined) raw.stock = row.getCell(fields.stock).value;
    if (fields.description !== undefined)
      raw.description = this.cellToString(row.getCell(fields.description));

    for (const { col, label } of unclaimed) {
      const value = this.cellToString(row.getCell(col));
      if (value.trim()) raw.extras.push({ label, value });
    }

    return raw;
  }

  private isRowEmpty(row: ExcelJS.Row): boolean {
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (this.cellToString(cell).trim()) hasValue = true;
    });
    return !hasValue;
  }

  private parsePrice(raw: unknown): { value: number; warning?: string } {
    if (raw === null || raw === undefined || raw === '') {
      return { value: 0, warning: 'Precio vacío' };
    }
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw >= 0
        ? { value: raw }
        : { value: 0, warning: 'Precio vacío' };
    }

    let str = textoPlano(raw).trim();
    str = str.replace(/[^\d.,-]/g, '');
    if (!str) return { value: 0, warning: 'Precio vacío' };

    const hasDot = str.includes('.');
    const hasComma = str.includes(',');
    let normalized = str;

    if (hasDot && hasComma) {
      const lastDot = str.lastIndexOf('.');
      const lastComma = str.lastIndexOf(',');
      normalized =
        lastComma > lastDot
          ? str.replace(/\./g, '').replace(',', '.')
          : str.replace(/,/g, '');
    } else if (hasComma && !hasDot) {
      const parts = str.split(',');
      const lastPart = parts[parts.length - 1];
      normalized =
        parts.length > 2 || (parts.length === 2 && lastPart.length === 3)
          ? str.replace(/,/g, '')
          : str.replace(',', '.');
    } else if (hasDot && !hasComma) {
      const parts = str.split('.');
      const lastPart = parts[parts.length - 1];
      if (parts.length > 2 || (parts.length === 2 && lastPart.length === 3)) {
        normalized = str.replace(/\./g, '');
      }
    }

    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0) {
      return { value: 0, warning: 'Precio vacío' };
    }
    return { value: num };
  }

  private parseStock(raw: unknown): number {
    if (raw === null || raw === undefined || raw === '') return 0;
    if (typeof raw === 'number')
      return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
    const num = Number(textoPlano(raw).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  }

  private buildDescription(raw: RawRow): string {
    const parts: string[] = [];
    if (raw.description?.trim()) parts.push(raw.description.trim());
    for (const extra of raw.extras) {
      if (extra.value.trim())
        parts.push(`${extra.label}: ${extra.value.trim()}`);
    }
    return parts.join('\n');
  }

  private indexEmbeddedImages(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
  ): { images: Map<number, EmbeddedImage>; imagesTruncated: boolean } {
    const map = new Map<number, EmbeddedImage>();
    let totalBytes = 0;
    let imagesTruncated = false;

    for (const img of worksheet.getImages()) {
      // A file with very few data rows but many/huge embedded images
      // shouldn't be able to blow up memory before a single row is even
      // processed — stop indexing once the cumulative buffered size crosses
      // the cap, regardless of how many images remain.
      if (totalBytes >= MAX_TOTAL_EMBEDDED_IMAGES_BYTES) {
        imagesTruncated = true;
        break;
      }

      const nativeRow = Math.floor(img.range.tl.nativeRow);
      const image = workbook.getImage(Number(img.imageId));
      if (image?.buffer) {
        const buffer = Buffer.from(image.buffer);
        totalBytes += buffer.length;
        map.set(nativeRow, { extension: image.extension, buffer });
      }
    }

    return { images: map, imagesTruncated };
  }

  private saveEmbeddedImage(
    image: EmbeddedImage,
    uploadsDir: string,
    companyId: string,
    baseUrl: string,
  ): string {
    fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${image.extension}`;
    fs.writeFileSync(path.join(uploadsDir, safeName), image.buffer);
    return `${baseUrl}/uploads/products/${companyId}/${safeName}`;
  }
}
