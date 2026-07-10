import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

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

const FIELD_ALIASES: Array<{ field: keyof Omit<RawRow, 'extras'>; aliases: string[] }> = [
  { field: 'name', aliases: ['nombre', 'producto', 'referencia', 'item', 'articulo', 'descripcion corta'] },
  { field: 'category', aliases: ['categoria', 'linea', 'tipo', 'familia', 'coleccion'] },
  { field: 'price', aliases: ['precio', 'valor', 'precio base', 'valor unitario', 'precio unitario', 'precio venta', 'venta'] },
  { field: 'imageUrl', aliases: ['imagen', 'foto', 'url imagen', 'image', 'imageurl', 'link imagen', 'fotografia'] },
  { field: 'code', aliases: ['codigo', 'code', 'referencia', 'ref'] },
  { field: 'sku', aliases: ['sku', 'referencia interna', 'sku interno'] },
  { field: 'stock', aliases: ['stock', 'cantidad', 'inventario', 'unidades'] },
  { field: 'description', aliases: ['descripcion', 'detalle', 'observaciones', 'notas'] },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.xlsx', '.xlsm'];

interface ColumnMap {
  fields: Partial<Record<keyof Omit<RawRow, 'extras'>, number>>;
  unclaimed: Array<{ col: number; label: string }>;
}

interface EmbeddedImage {
  extension: string;
  buffer: Buffer;
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

    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs bundles its own Buffer typing, incompatible with this project's
      // @types/node at the type level only (runtime accepts a plain Buffer fine).
      await workbook.xlsx.load(Buffer.from(file!.buffer) as any);
    } catch {
      throw new BadRequestException(
        'No se pudo leer el archivo. Verifica que sea un Excel .xlsx válido y no esté dañado.',
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('El Excel no tiene ninguna hoja con datos.');
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

    const images = this.indexEmbeddedImages(workbook, worksheet);
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
        (p) => `${p.name.trim().toLowerCase()}|${(p.category ?? '').trim().toLowerCase()}`,
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

    const uploadsDir = path.join(process.cwd(), 'uploads', 'products', companyId);
    const lastRow = worksheet.actualRowCount;

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
      const { value: price, warning: priceWarning } = this.parsePrice(raw.price);
      if (priceWarning) {
        summary.warnings.push({ rowNumber, reason: priceWarning, rawName: name });
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
        summary.warnings.push({ rowNumber, reason: 'Producto duplicado', rawName: name });
        continue;
      }

      let imageUrl: string | undefined;
      const urlValue = raw.imageUrl?.trim();
      if (urlValue && /^https?:\/\//i.test(urlValue)) {
        imageUrl = urlValue;
      } else {
        const embedded = images.get(rowNumber - 1);
        if (embedded) {
          try {
            imageUrl = this.saveEmbeddedImage(embedded, uploadsDir, companyId, baseUrl);
          } catch {
            summary.warnings.push({
              rowNumber,
              reason: 'No se pudo guardar la imagen embebida',
              rawName: name,
            });
          }
        }
      }

      const description = this.buildDescription(raw);

      const created = await this.prisma.product.create({
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

      summary.created++;
      summary.products.push({
        id: created.id,
        name: created.name,
        category: created.category,
        price: created.price,
      });

      if (skuKey) seenSku.add(skuKey);
      if (codeKey) seenCode.add(codeKey);
      seenNameCategory.add(nameCategoryKey);
    }

    return summary;
  }

  private validateFile(file: UploadedExcelFile | undefined): void {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('El archivo es requerido');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xls') {
      throw new BadRequestException(
        'El formato .xls (Excel 97-2003) no es compatible. Guarda el archivo como .xlsx desde Excel e intenta de nuevo.',
      );
    }
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException('Formato de archivo no permitido. Usa un archivo .xlsx');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo supera el tamaño máximo permitido (10MB)');
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
    const headers: Array<{ col: number; normalized: string; original: string }> = [];
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
        return String(obj.text ?? obj.hyperlink ?? '');
      }
      if ('result' in obj) {
        return String(obj.result ?? '');
      }
      return '';
    }
    return String(value);
  }

  private extractRowValues(row: ExcelJS.Row, columnMap: ColumnMap): RawRow {
    const raw: RawRow = { extras: [] };
    const { fields, unclaimed } = columnMap;

    if (fields.name !== undefined) raw.name = this.cellToString(row.getCell(fields.name));
    if (fields.category !== undefined) raw.category = this.cellToString(row.getCell(fields.category));
    if (fields.price !== undefined) raw.price = row.getCell(fields.price).value;
    if (fields.imageUrl !== undefined) raw.imageUrl = this.cellToString(row.getCell(fields.imageUrl));
    if (fields.code !== undefined) raw.code = this.cellToString(row.getCell(fields.code));
    if (fields.sku !== undefined) raw.sku = this.cellToString(row.getCell(fields.sku));
    if (fields.stock !== undefined) raw.stock = row.getCell(fields.stock).value;
    if (fields.description !== undefined) raw.description = this.cellToString(row.getCell(fields.description));

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

    let str = String(raw).trim();
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
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
    const num = Number(String(raw).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  }

  private buildDescription(raw: RawRow): string {
    const parts: string[] = [];
    if (raw.description?.trim()) parts.push(raw.description.trim());
    for (const extra of raw.extras) {
      if (extra.value.trim()) parts.push(`${extra.label}: ${extra.value.trim()}`);
    }
    return parts.join('\n');
  }

  private indexEmbeddedImages(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
  ): Map<number, EmbeddedImage> {
    const map = new Map<number, EmbeddedImage>();
    for (const img of worksheet.getImages()) {
      const nativeRow = Math.floor(img.range.tl.nativeRow);
      const image = workbook.getImage(Number(img.imageId));
      if (image?.buffer) {
        map.set(nativeRow, { extension: image.extension, buffer: Buffer.from(image.buffer) });
      }
    }
    return map;
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
