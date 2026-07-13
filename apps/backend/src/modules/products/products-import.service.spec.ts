import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';
import { ProductsImportService } from './products-import.service';
import {
  MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES,
  MAX_PRODUCT_IMPORT_ROWS,
  PRODUCT_IMPORT_BATCH_SIZE,
} from './products-import.constants';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// A minimal valid 1x1 transparent PNG, used only to exercise the embedded-image
// extraction path without any external fixture file.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function buildWorkbookBuffer(
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Productos');
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function fakeExcelFile(buffer: Buffer, name = 'catalogo.xlsx') {
  return { buffer, originalname: name, size: buffer.length };
}

async function buildWorkbookWithRowCount(rowCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Productos');
  worksheet.addRow(['Nombre', 'Precio']);
  for (let i = 0; i < rowCount; i++) {
    worksheet.addRow([`Producto ${i}`, 1000 + i]);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('ProductsImportService', () => {
  let prisma: any;
  let service: ProductsImportService;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `id-${Math.random()}`, ...args.data }),
        ),
      },
    };
    service = new ProductsImportService(prisma);
  });

  it('imports products from basic columns (name + price)', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Precio'],
      [['Sala Primavera', 11700000]],
    );

    const summary = await service.importFromExcel(
      'company-a',
      fakeExcelFile(buffer),
      'http://localhost:3001',
    );

    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        name: 'Sala Primavera',
        category: 'Sin categoría',
        price: 11700000,
        stock: 0,
      }),
    });
  });

  it('converts COP-formatted prices correctly', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Precio'],
      [
        ['Sala A', '$ 11.700.000'],
        ['Sala B', '11,700,000'],
        ['Sala C', '6800000'],
      ],
    );

    await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    const prices = prisma.product.create.mock.calls.map((c: any) => c[0].data.price);
    expect(prices).toEqual([11700000, 11700000, 6800000]);
  });

  it('skips a row with no usable name and reports it as an error', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Precio'],
      [
        ['', 100000],
        ['Comedor Real', 200000],
      ],
    );

    const summary = await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(summary.totalRows).toBe(2);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual([
      expect.objectContaining({ rowNumber: 2, reason: 'Sin nombre' }),
    ]);
  });

  it('defaults empty category to "Sin categoría" and warns on empty price', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Categoria', 'Precio'],
      [['Capsula Nido', '', '']],
    );

    const summary = await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ category: 'Sin categoría', price: 0 }),
    });
    expect(summary.warnings).toEqual([
      expect.objectContaining({ rowNumber: 2, reason: 'Precio vacío', rawName: 'Capsula Nido' }),
    ]);
  });

  it('skips a duplicate by name + category and reports it as a warning', async () => {
    prisma.product.findMany.mockResolvedValue([
      { sku: null, code: null, name: 'Sala Primavera', category: 'Salas' },
    ]);
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Categoria', 'Precio'],
      [['Sala Primavera', 'Salas', 11700000]],
    );

    const summary = await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(summary.created).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.warnings).toEqual([
      expect.objectContaining({ rowNumber: 2, reason: 'Producto duplicado' }),
    ]);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('skips a duplicate created earlier in the same file (in-batch duplicate)', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Categoria', 'Precio'],
      [
        ['Sala Primavera', 'Salas', 11700000],
        ['Sala Primavera', 'Salas', 9900000],
      ],
    );

    const summary = await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.warnings).toEqual([
      expect.objectContaining({ rowNumber: 3, reason: 'Producto duplicado' }),
    ]);
  });

  it('folds unmapped extra columns into description', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Precio', 'Material', 'Medidas'],
      [['Sala Primavera', 11700000, 'Ratán natural', 'Sofá 230x93x63']],
    );

    await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Material: Ratán natural\nMedidas: Sofá 230x93x63',
      }),
    });
  });

  it('extracts an embedded image and stores it as an internal file (imageUrl points to /uploads)', async () => {
    const mkdirMock = fs.mkdirSync as jest.Mock;
    const writeFileMock = fs.writeFileSync as jest.Mock;
    mkdirMock.mockClear();
    writeFileMock.mockClear();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Productos');
    worksheet.addRow(['Nombre', 'Precio']);
    worksheet.addRow(['Sala Primavera', 11700000]);

    const imageBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');
    const imageId = workbook.addImage({ buffer: imageBuffer, extension: 'png' });
    worksheet.addImage(imageId, {
      tl: { col: 2, row: 1 },
      ext: { width: 50, height: 50 },
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(mkdirMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalled();
    const [, writtenBuffer] = writeFileMock.mock.calls[0];
    expect(Buffer.compare(writtenBuffer as Buffer, imageBuffer)).toBe(0);

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        imageUrl: expect.stringMatching(
          /^http:\/\/localhost:3001\/uploads\/products\/company-a\/.+\.png$/,
        ),
      }),
    });
  });

  it('rejects a .xls file with a clear message instead of failing silently', async () => {
    const buffer = await buildWorkbookBuffer(['Nombre', 'Precio'], [['Sala', 100]]);

    await expect(
      service.importFromExcel(
        'company-a',
        fakeExcelFile(buffer, 'catalogo.xls'),
        'http://localhost:3001',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when no file is provided', async () => {
    await expect(
      service.importFromExcel('company-a', undefined, 'http://localhost:3001'),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a file at the 50MB size limit', async () => {
    const buffer = await buildWorkbookBuffer(['Nombre', 'Precio'], [['Sala', 100]]);
    const file = fakeExcelFile(buffer);
    // Report the file as exactly at the limit without allocating a real 50MB buffer.
    (file as any).size = MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES;

    const summary = await service.importFromExcel('company-a', file, 'http://localhost:3001');
    expect(summary.created).toBe(1);
  });

  it('rejects a file larger than 50MB with a clear MB-aware message', async () => {
    const buffer = await buildWorkbookBuffer(['Nombre', 'Precio'], [['Sala', 100]]);
    const file = fakeExcelFile(buffer);
    (file as any).size = MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES + 1;

    await expect(
      service.importFromExcel('company-a', file, 'http://localhost:3001'),
    ).rejects.toThrow('El archivo supera el tamaño máximo permitido de 50MB.');
  });

  it('rejects an Excel with more rows than the configured maximum', async () => {
    const buffer = await buildWorkbookWithRowCount(MAX_PRODUCT_IMPORT_ROWS + 1);

    await expect(
      service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001'),
    ).rejects.toThrow(
      `El archivo tiene demasiadas filas. Máximo permitido: ${MAX_PRODUCT_IMPORT_ROWS.toLocaleString('es-CO')} productos por importación.`,
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  }, 20000);

  it('accepts an Excel at exactly the row limit', async () => {
    const buffer = await buildWorkbookWithRowCount(MAX_PRODUCT_IMPORT_ROWS);

    const summary = await service.importFromExcel(
      'company-a',
      fakeExcelFile(buffer),
      'http://localhost:3001',
    );

    expect(summary.totalRows).toBe(MAX_PRODUCT_IMPORT_ROWS);
    expect(summary.created).toBe(MAX_PRODUCT_IMPORT_ROWS);
  }, 20000);

  it('processes more rows than a single batch without dropping any', async () => {
    const rowCount = PRODUCT_IMPORT_BATCH_SIZE * 2 + 10;
    const buffer = await buildWorkbookWithRowCount(rowCount);

    const summary = await service.importFromExcel(
      'company-a',
      fakeExcelFile(buffer),
      'http://localhost:3001',
    );

    expect(summary.created).toBe(rowCount);
    expect(prisma.product.create).toHaveBeenCalledTimes(rowCount);
  }, 20000);

  it('isolates a single failed row within a batch instead of failing the whole import', async () => {
    const buffer = await buildWorkbookBuffer(
      ['Nombre', 'Precio'],
      [
        ['Sala A', 100],
        ['Sala B', 200],
        ['Sala C', 300],
      ],
    );

    prisma.product.create.mockImplementation((args: any) => {
      if (args.data.name === 'Sala B') {
        return Promise.reject(new Error('db hiccup'));
      }
      return Promise.resolve({ id: `id-${Math.random()}`, ...args.data });
    });

    const summary = await service.importFromExcel(
      'company-a',
      fakeExcelFile(buffer),
      'http://localhost:3001',
    );

    expect(summary.created).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual([
      expect.objectContaining({ rowNumber: 3, reason: 'No se pudo guardar el producto', rawName: 'Sala B' }),
    ]);
  });

  it('only reads and writes products scoped to the authenticated company', async () => {
    const buffer = await buildWorkbookBuffer(['Nombre', 'Precio'], [['Sala', 100]]);

    await service.importFromExcel('company-a', fakeExcelFile(buffer), 'http://localhost:3001');

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-a' } }),
    );
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-a' }) }),
    );
  });
});
