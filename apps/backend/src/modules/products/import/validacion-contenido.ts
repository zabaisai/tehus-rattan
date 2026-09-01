import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

// Validación de CONTENIDO (no solo extensión) del archivo de importación.
//
// Un `.xlsx` es un ZIP (OOXML). Antes de que exceljs lo cargue en memoria se
// valida la firma y la estructura del ZIP leyendo el DIRECTORIO CENTRAL, sin
// dependencias, para frenar:
//   - un archivo que NO es un ZIP (extensión falsa, HTML/ejecutable renombrado);
//   - un ZIP BOMBA (pocas entradas que se expanden a gigas);
//   - PATH TRAVERSAL en los nombres de entrada (`../`, rutas absolutas).
// Para `.csv` se comprueba que sea texto (no binario ni HTML).

const ZIP_LOCAL_SIG = 0x04034b50; // PK\x03\x04
const ZIP_EOCD_SIG = 0x06054b50; // PK\x05\x06
const ZIP_CDH_SIG = 0x02014b50; // PK\x01\x02

// Topes defensivos de un .xlsx razonable.
const MAX_ENTRIES = 512;
const MAX_ENTRY_UNCOMPRESSED = 100 * 1024 * 1024; // 100 MB por entrada
const MAX_TOTAL_UNCOMPRESSED = 300 * 1024 * 1024; // 300 MB total expandido
const MAX_RATIO = 200; // ratio de compresión por entrada (anti-bomba)

function esNombreDeEntradaPeligroso(nombre: string): boolean {
  if (!nombre) return false;
  const n = nombre.replace(/\\/g, '/');
  if (n.startsWith('/')) return true; // ruta absoluta
  if (/^[a-zA-Z]:/.test(n)) return true; // C:\ ...
  return n.split('/').some((seg) => seg === '..'); // traversal
}

/** Valida la firma + estructura de un ZIP/OOXML (.xlsx). Lanza si es peligroso. */
export function validarZipOoxml(buffer: Buffer): void {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== ZIP_LOCAL_SIG) {
    throw new BadRequestException(
      'El archivo no es un .xlsx válido (firma incorrecta).',
    );
  }

  // Buscar el End Of Central Directory (EOCD) desde el final. El comentario
  // final puede tener hasta 65535 bytes, así que se busca en esa ventana.
  const maxBack = Math.min(buffer.length, 22 + 65535);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= buffer.length - maxBack; i--) {
    if (i < 0) break;
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new BadRequestException('El .xlsx está dañado (sin EOCD).');
  }

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries > MAX_ENTRIES) {
    throw new BadRequestException(
      'El .xlsx tiene demasiadas entradas internas.',
    );
  }
  if (cdOffset >= buffer.length) {
    throw new BadRequestException('El .xlsx está dañado (offset inválido).');
  }

  let cursor = cdOffset;
  let totalUncompressed = 0;
  let contentTypesPresente = false;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.length) {
      throw new BadRequestException('El .xlsx está dañado (directorio).');
    }
    if (buffer.readUInt32LE(cursor) !== ZIP_CDH_SIG) {
      throw new BadRequestException('El .xlsx está dañado (cabecera).');
    }
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    if (nameStart + nameLen > buffer.length) {
      throw new BadRequestException('El .xlsx está dañado (nombre).');
    }
    const nombre = buffer
      .subarray(nameStart, nameStart + nameLen)
      .toString('utf8');

    if (esNombreDeEntradaPeligroso(nombre)) {
      throw new BadRequestException(
        'El .xlsx contiene una ruta interna no permitida.',
      );
    }
    if (uncompressed > MAX_ENTRY_UNCOMPRESSED) {
      throw new BadRequestException(
        'Una entrada del .xlsx es demasiado grande al descomprimir.',
      );
    }
    if (compressed > 0 && uncompressed / compressed > MAX_RATIO) {
      throw new BadRequestException(
        'El .xlsx tiene una ratio de compresión sospechosa (posible zip bomb).',
      );
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new BadRequestException(
        'El .xlsx se expande a un tamaño no permitido (posible zip bomb).',
      );
    }
    if (nombre === '[Content_Types].xml') contentTypesPresente = true;

    cursor = nameStart + nameLen + extraLen + commentLen;
  }

  // Un OOXML legítimo SIEMPRE trae [Content_Types].xml. Su ausencia delata un
  // ZIP que no es un libro de Excel.
  if (!contentTypesPresente) {
    throw new BadRequestException(
      'El archivo no es un libro de Excel válido (falta [Content_Types].xml).',
    );
  }
}

/** Valida que un .csv sea texto (no binario, no HTML). */
export function validarCsvTexto(buffer: Buffer): void {
  // Un CSV no tiene bytes NUL; un binario o ejecutable sí.
  const muestra = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (muestra.includes(0)) {
    throw new BadRequestException(
      'El .csv contiene datos binarios no válidos.',
    );
  }
  // Rechazar HTML disfrazado de CSV.
  const inicio = muestra.toString('utf8').trimStart().toLowerCase();
  if (inicio.startsWith('<!doctype html') || inicio.startsWith('<html')) {
    throw new BadRequestException('El archivo parece HTML, no un CSV.');
  }
}

/** Valida el contenido según la extensión ya comprobada. */
export function validarContenidoDeImportacion(
  buffer: Buffer,
  nombre: string,
): void {
  const ext = path.extname(nombre).toLowerCase();
  if (ext === '.xlsx') validarZipOoxml(buffer);
  else if (ext === '.csv') validarCsvTexto(buffer);
}
