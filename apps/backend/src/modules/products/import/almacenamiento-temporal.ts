import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diskStorage } from 'multer';
import { MARGEN_DISCO_BYTES } from '../products-import.constants';

/**
 * A DISCO, no a memoria.
 *
 * `FileInterceptor` sin `storage` guarda el archivo entero en RAM: un catalogo
 * de 200 MB son 200 MB de RSS antes de que nadie lo mire, y con dos subidas a
 * la vez el proceso se muere. En disco, la memoria del proceso deja de
 * depender del tamaño del archivo.
 */
export function carpetaDeImportaciones(): string {
  return (
    process.env.PRODUCT_IMPORT_TMP_DIR?.trim() ||
    path.join(os.tmpdir(), 'takto-importaciones')
  );
}

/**
 * Espacio libre en el disco donde se van a escribir los temporales.
 *
 * `statfs` puede no existir en algun sistema; si no se puede medir, se deja
 * pasar en vez de bloquear la funcion entera. Rechazar por no poder comprobar
 * seria peor que el problema que evita.
 */
export async function espacioLibre(ruta: string): Promise<number | null> {
  const statfs = (
    fs.promises as unknown as {
      statfs?: (p: string) => Promise<{ bavail: number; bsize: number }>;
    }
  ).statfs;
  if (!statfs) return null;
  try {
    const s = await statfs(ruta);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/**
 * Comprueba que el archivo CABE antes de aceptarlo.
 *
 * Aceptar una subida que no cabe llena el disco del servidor y se lleva por
 * delante a todo lo demas —la base, los logs, el propio producto—, no solo a
 * la importacion. Se exige margen ademas del tamaño del archivo.
 */
export async function comprobarEspacio(tamañoEsperado: number): Promise<void> {
  const carpeta = carpetaDeImportaciones();
  await fs.promises.mkdir(carpeta, { recursive: true });

  const libre = await espacioLibre(carpeta);
  if (libre === null) return;

  if (libre < tamañoEsperado + MARGEN_DISCO_BYTES) {
    throw new BadRequestException(
      'No hay espacio suficiente en el servidor para procesar un archivo de ese tamaño. Inténtalo más tarde o divide el catálogo.',
    );
  }
}

/**
 * Almacenamiento en disco para multer.
 *
 * El nombre se genera aqui y NUNCA sale del que envia el cliente: un
 * `../../etc/passwd` como nombre de archivo escribiria fuera de la carpeta. La
 * extension se conserva porque el lector la necesita para saber si es CSV o
 * XLSX, pero acotada a una lista.
 */
export const almacenamientoEnDisco = diskStorage({
  destination: (_req, _file, cb) => {
    const carpeta = carpetaDeImportaciones();
    fs.mkdir(carpeta, { recursive: true }, (error) => cb(error, carpeta));
  },
  filename: (_req, file, cb) => {
    const ext = extensionSegura(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

function extensionSegura(nombre: string): string {
  const ext = path.extname(nombre).toLowerCase();
  return ['.xlsx', '.csv'].includes(ext) ? ext : '.dat';
}

/**
 * Borra los temporales que quedaron huerfanos.
 *
 * Un worker que muere a mitad deja su archivo en disco para siempre. Sin esta
 * barrida, el disco se llena de restos de importaciones que ya nadie mira.
 */
export async function barrerHuerfanos(
  edadMinimaMs = 24 * 60 * 60_000,
  ahora = Date.now(),
): Promise<{ borrados: number }> {
  const carpeta = carpetaDeImportaciones();
  let borrados = 0;

  const entradas = await fs.promises
    .readdir(carpeta)
    .catch(() => [] as string[]);
  for (const nombre of entradas) {
    const completa = path.join(carpeta, nombre);
    try {
      const info = await fs.promises.stat(completa);
      if (!info.isFile()) continue;
      if (ahora - info.mtimeMs < edadMinimaMs) continue;
      await fs.promises.unlink(completa);
      borrados++;
    } catch {
      // Un archivo que desaparece entre el listado y el borrado no es un
      // problema: alguien ya lo limpio.
    }
  }

  return { borrados };
}
