import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { diskStorage } from 'multer';
import { MARGEN_DISCO_BYTES } from '../products-import.constants';
import {
  carpetaDeAlmacenamiento,
  generarClave,
} from './almacenamiento-importaciones';

/**
 * A DISCO, no a memoria.
 *
 * `FileInterceptor` sin `storage` guarda el archivo entero en RAM: un catalogo
 * de 200 MB son 200 MB de RSS antes de que nadie lo mire, y con dos subidas a
 * la vez el proceso se muere. En disco, la memoria del proceso deja de
 * depender del tamaño del archivo.
 *
 * EL DESTINO ES EL ALMACENAMIENTO COMPARTIDO, no el `/tmp` del proceso: quien
 * lee el archivo despues es el worker, que es otro contenedor. Ver
 * `almacenamiento-importaciones.ts`.
 */
export function carpetaDeImportaciones(): string {
  return carpetaDeAlmacenamiento();
}

/**
 * Espacio libre en el disco donde se van a escribir los archivos.
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
 * Almacenamiento en disco para multer, apuntando al directorio compartido.
 *
 * El nombre lo genera `generarClave` y NUNCA sale del que envia el cliente: un
 * `../../etc/passwd` como nombre de archivo escribiria fuera de la carpeta. La
 * extension se conserva porque el lector la necesita para saber si es CSV o
 * XLSX, pero acotada a una lista.
 *
 * Multer escribe directamente en el destino final, asi que la clave que devuelve
 * `file.filename` es la que se guarda en la base. No hay copia intermedia.
 */
export const almacenamientoEnDisco = diskStorage({
  destination: (_req, _file, cb) => {
    const carpeta = carpetaDeImportaciones();
    fs.mkdir(carpeta, { recursive: true }, (error) => cb(error, carpeta));
  },
  filename: (_req, file, cb) => {
    cb(null, generarClave(file.originalname));
  },
});
