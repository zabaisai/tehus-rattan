import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  validarContenidoDeImportacion,
  validarCsvTexto,
  validarZipOoxml,
} from './validacion-contenido';

// Construye un ZIP mínimo (un solo archivo almacenado, sin comprimir) con el
// nombre y los tamaños indicados en el directorio central. Permite fabricar
// casos hostiles (bomba, traversal) de forma determinista.
function construirZip(
  entradas: Array<{ nombre: string; uncompressed: number; compressed: number }>,
): Buffer {
  const localSig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  // Cabecera local mínima (30 bytes) + nombre, contenido vacío.
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const nameBuf = Buffer.from(e.nombre, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt32LE(e.compressed, 20);
    cdh.writeUInt32LE(e.uncompressed, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);
    offset += local.length + nameBuf.length;
  }
  const body = Buffer.concat(parts);
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  const zip = Buffer.concat([body, cd, eocd]);
  // Asegurar la firma local al inicio.
  localSig.copy(zip, 0);
  return zip;
}

describe('validarContenidoDeImportacion', () => {
  it('rechaza un archivo con firma que no es ZIP (extensión falsa)', () => {
    const html = Buffer.from('<!DOCTYPE html><html></html>');
    expect(() => validarZipOoxml(html)).toThrow(BadRequestException);
  });

  it('rechaza un .xlsx sin [Content_Types].xml (no es un libro real)', () => {
    const zip = construirZip([
      { nombre: 'otra-cosa.xml', uncompressed: 10, compressed: 10 },
    ]);
    expect(() => validarZipOoxml(zip)).toThrow(/Content_Types/);
  });

  it('rechaza path traversal en el nombre de entrada', () => {
    const zip = construirZip([
      { nombre: '../../evil.sh', uncompressed: 10, compressed: 10 },
      { nombre: '[Content_Types].xml', uncompressed: 10, compressed: 10 },
    ]);
    expect(() => validarZipOoxml(zip)).toThrow(/ruta interna/);
  });

  it('rechaza una zip bomb por ratio de compresión', () => {
    const zip = construirZip([
      {
        nombre: '[Content_Types].xml',
        uncompressed: 500_000_000,
        compressed: 1000,
      },
    ]);
    expect(() => validarZipOoxml(zip)).toThrow(/zip bomb|demasiado grande/i);
  });

  it('rechaza una zip bomb por tamaño total expandido', () => {
    const entradas = [
      { nombre: '[Content_Types].xml', uncompressed: 10, compressed: 10 },
    ];
    for (let i = 0; i < 5; i++) {
      entradas.push({
        nombre: `xl/big${i}.bin`,
        uncompressed: 80 * 1024 * 1024,
        compressed: 70 * 1024 * 1024,
      });
    }
    expect(() => validarZipOoxml(construirZip(entradas))).toThrow(/zip bomb/i);
  });

  it('acepta un .xlsx REAL generado con exceljs', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Productos');
    ws.addRow(['nombre', 'precio']);
    ws.addRow(['Silla', 100]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() =>
      validarContenidoDeImportacion(buffer, 'catalogo.xlsx'),
    ).not.toThrow();
  });

  describe('.csv', () => {
    it('acepta texto CSV normal', () => {
      expect(() =>
        validarCsvTexto(Buffer.from('nombre,precio\nSilla,100\n')),
      ).not.toThrow();
    });
    it('rechaza binario disfrazado (bytes NUL)', () => {
      expect(() =>
        validarCsvTexto(Buffer.from([0x6e, 0x00, 0x6d, 0x65])),
      ).toThrow(/binarios/);
    });
    it('rechaza HTML disfrazado de CSV', () => {
      expect(() =>
        validarCsvTexto(Buffer.from('<!DOCTYPE html><html>x</html>')),
      ).toThrow(/HTML/);
    });
  });
});
