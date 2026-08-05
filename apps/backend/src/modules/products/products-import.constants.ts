// Single source of truth for both the Multer upload limit (controller) and
// the service's own re-check — keeping one constant means they can never
// silently drift apart the way the old two-hardcoded-10MB-literals setup did.
//
// CONFIGURABLE, PERO EL TECHO REAL NO LO PONE ESTA CONSTANTE.
//
// El limite efectivo es el MENOR de tres cosas, y subir esta sin subir las
// otras solo cambia donde aparece el error:
//
//   1. `PRODUCT_IMPORT_MAX_MB` (esto).
//   2. `request_body max_size` de Caddy, hoy 55 MB en el dominio de la API.
//      Por encima de eso la peticion muere en el proxy y el backend ni se
//      entera: quien sube el archivo ve un error de red, no un mensaje.
//   3. La memoria del proceso. Hoy el archivo se lee ENTERO en memoria
//      (`FileInterceptor` sin `storage` y `workbook.xlsx.load(buffer)`), asi
//      que un archivo de 500 MB son 500 MB de RSS mas lo que exceljs
//      construya encima, en un VPS que no los tiene.
//
// Medido en staging: el techo operativo seguro son ~50 MB. Llegar a 500 MB
// exige carga a disco por fragmentos y lectura en streaming, que esta
// documentado como pendiente en TAKTO-FUNCTIONAL-HARDENING-STATE.md.
const MB_POR_DEFECTO = 50;

function leerLimiteMb(): number {
  const crudo = process.env.PRODUCT_IMPORT_MAX_MB;
  if (!crudo) return MB_POR_DEFECTO;
  const n = Number(crudo);
  // Un valor invalido NO sube el limite en silencio: se vuelve al conservador.
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : MB_POR_DEFECTO;
}

export const MAX_PRODUCT_IMPORT_FILE_SIZE_MB = leerLimiteMb();
export const MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES =
  MAX_PRODUCT_IMPORT_FILE_SIZE_MB * 1024 * 1024;

export const FILE_TOO_LARGE_MESSAGE = `El archivo supera el tamaño máximo permitido de ${MAX_PRODUCT_IMPORT_FILE_SIZE_MB}MB.`;

// MVP ceiling on data rows per import — protects the request from running
// for an unbounded amount of time (and the DB from an unbounded write burst)
// if someone uploads a catalog far larger than any real company's.
export const MAX_PRODUCT_IMPORT_ROWS = 10000;

export const TOO_MANY_ROWS_MESSAGE = `El archivo tiene demasiadas filas. Máximo permitido: ${MAX_PRODUCT_IMPORT_ROWS.toLocaleString('es-CO')} productos por importación.`;

// Rows are validated and deduplicated in memory (cheap), then their actual
// product.create() calls are flushed in bounded concurrent chunks instead of
// one fully sequential await per row.
export const PRODUCT_IMPORT_BATCH_SIZE = 250;

// summary.products is only ever used as a short preview by callers — never
// rendered in full by the frontend — so it's capped regardless of how many
// rows the import actually creates.
export const PRODUCT_IMPORT_PREVIEW_LIMIT = 200;

// A single embedded image this large is almost certainly not a product
// photo — skip it (with a clear per-row warning) rather than buffering it
// into memory and writing it to disk.
export const MAX_EMBEDDED_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Upper bound on the total bytes of embedded images buffered into memory
// while indexing a workbook's images, independent of row count — a file
// with very few data rows but many/huge embedded images shouldn't be able
// to blow up memory before a single row is even processed.
export const MAX_TOTAL_EMBEDDED_IMAGES_BYTES = 100 * 1024 * 1024;
