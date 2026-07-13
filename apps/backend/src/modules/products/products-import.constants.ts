// Single source of truth for both the Multer upload limit (controller) and
// the service's own re-check — keeping one constant means they can never
// silently drift apart the way the old two-hardcoded-10MB-literals setup did.
export const MAX_PRODUCT_IMPORT_FILE_SIZE_MB = 50;
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
