import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Workbook } from 'exceljs';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ImportacionDeProductosService } from './import/importacion.service';
import { ImportacionQueue } from './import/importacion.queue';
import { SubirImportacionDto } from './import/dto';
import {
  generarClave,
  resolverRutaDeClave,
} from './import/almacenamiento-importaciones';

/**
 * PATH-INJECTION EN LA SUBIDA (CodeQL: uncontrolled data used in path).
 *
 * El controlador NO debe tocar el disco con `file.path` (una ruta absoluta que
 * multer deriva del entorno) ni con `file.originalname`. Debe reconstruir la
 * ruta desde el directorio de almacenamiento del servidor y la CLAVE generada
 * por el servidor (`file.filename`), resuelta canónicamente y confinada a la
 * raíz — el mismo helper para leer y para borrar.
 *
 * Estas pruebas fijan ese contrato: el flujo legítimo lee por la ruta segura y
 * registra con `file.filename`; una clave manipulada se rechaza sin llegar a
 * usar `file.path`.
 */
describe('ProductsController · subida de importación · ruta segura', () => {
  let carpeta: string;
  let controller: ProductsController;
  let registrar: jest.Mock;

  const req = { user: { companyId: 'empresa-1', sub: 'user-1' } } as any;

  beforeAll(async () => {
    carpeta = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'takto-ctrl-import-'),
    );
    process.env.PRODUCT_IMPORT_STORAGE_DIR = carpeta;
  });

  afterAll(async () => {
    delete process.env.PRODUCT_IMPORT_STORAGE_DIR;
    await fs.promises.rm(carpeta, { recursive: true, force: true });
  });

  beforeEach(() => {
    registrar = jest.fn().mockResolvedValue({ id: 'imp-1', status: 'PENDING' });
    const importaciones = {
      registrar,
    } as unknown as ImportacionDeProductosService;
    controller = new ProductsController(
      {} as unknown as ProductsService,
      importaciones,
      {} as unknown as ImportacionQueue,
    );
  });

  function archivoMulter(
    filename: string,
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname: 'catálogo.csv',
      encoding: '7bit',
      mimetype: 'text/csv',
      size: 42,
      destination: carpeta,
      filename,
      // `path` DELIBERADAMENTE apunta a un sitio que la prueba vigila: si el
      // controlador lo usara, lo detectaríamos.
      path: path.join(carpeta, filename),
      buffer: Buffer.alloc(0),
      ...overrides,
    } as unknown as Express.Multer.File;
  }

  const dto = {} as SubirImportacionDto;

  it('flujo legítimo CSV: lee por la ruta segura y registra con file.filename', async () => {
    const clave = generarClave('catalogo.csv'); // clave válida del servidor
    const rutaReal = resolverRutaDeClave(clave);
    await fs.promises.writeFile(
      rutaReal,
      'Nombre,SKU,Precio\nSilla,SKU-1,1000\n',
      'utf8',
    );

    const file = archivoMulter(clave, { size: 34 });
    const res = await controller.subirImportacion(file, req, dto);

    expect(res).toMatchObject({ id: 'imp-1' });
    // Se registró con la CLAVE del servidor, nunca con originalname ni con path.
    expect(registrar).toHaveBeenCalledTimes(1);
    const [, , meta] = registrar.mock.calls[0];
    expect(meta.clave).toBe(clave);
    // El archivo legítimo sigue en disco (no se borró en el camino feliz).
    expect(fs.existsSync(rutaReal)).toBe(true);
  });

  it('flujo legítimo XLSX (OOXML real): acepta y registra', async () => {
    // XLSX mínimo REAL creado con exceljs, para que la validación de contenido
    // (firma + estructura ZIP) lo acepte de verdad, no un mock.
    const wb = new Workbook();
    const ws = wb.addWorksheet('Hoja1');
    ws.addRow(['Nombre', 'SKU', 'Precio']);
    ws.addRow(['Mesa', 'SKU-2', '2000']);

    const clave = generarClave('catalogo.xlsx');
    const rutaReal = resolverRutaDeClave(clave);
    await wb.xlsx.writeFile(rutaReal);
    const { size } = await fs.promises.stat(rutaReal);

    const file = archivoMulter(clave, {
      originalname: 'catalogo.xlsx',
      mimetype:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size,
    });
    const res = await controller.subirImportacion(file, req, dto);

    expect(res).toMatchObject({ id: 'imp-1' });
    expect(registrar.mock.calls[0][2].clave).toBe(clave);
  });

  it.each([
    ['../../evil.csv', 'traversal'],
    ['/etc/passwd', 'ruta absoluta'],
    ['sub/otro.csv', 'con separador'],
    ['catalogo.csv', 'nombre del cliente, no clave del servidor'],
  ])(
    'clave manipulada %s (%s): 400, no registra y no toca file.path',
    async (claveMala) => {
      // Un archivo señuelo en `file.path`: si el controlador lo borrara, la
      // prueba lo vería desaparecer.
      const senuela = path.join(carpeta, 'senuela.keep');
      await fs.promises.writeFile(senuela, 'no me toques', 'utf8');

      const file = archivoMulter(claveMala);
      // Forzamos que `path` sea el señuelo real para el caso traversal.
      (file as any).path = senuela;

      await expect(
        controller.subirImportacion(file, req, dto),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(registrar).not.toHaveBeenCalled();
      // El señuelo NO se borró: el controlador nunca usó file.path.
      expect(fs.existsSync(senuela)).toBe(true);
      await fs.promises.unlink(senuela).catch(() => undefined);
    },
  );

  it('contenido hostil con clave válida: rechaza y BORRA por la ruta segura', async () => {
    // Clave válida pero el archivo en disco NO es un CSV/XLSX real: la
    // validación de contenido lo rechaza y el temporal se limpia usando la
    // MISMA ruta segura (no file.path).
    const clave = generarClave('trampa.csv');
    const rutaReal = resolverRutaDeClave(clave);
    // Bytes binarios que no son texto CSV ni un ZIP OOXML.
    await fs.promises.writeFile(
      rutaReal,
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );

    const file = archivoMulter(clave, { size: 4 });
    await expect(
      controller.subirImportacion(file, req, dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(registrar).not.toHaveBeenCalled();
    // Se borró por la ruta segura reconstruida desde la clave.
    expect(fs.existsSync(rutaReal)).toBe(false);
  });
});
