import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES,
} from '../products-import.constants';

/**
 * `.xlsm` NO entra. Es el formato de Excel CON MACROS.
 *
 * Aqui nadie ejecuta esas macros —solo se leen celdas— pero el archivo queda
 * almacenado y acaba descargandose en el equipo de alguien, donde Excel si
 * pregunta si quiere habilitarlas. Un catalogo de productos son datos, y los
 * datos se guardan igual de bien en `.xlsx` o `.csv`.
 */
export const EXTENSIONES_PERMITIDAS = ['.xlsx', '.csv'];

/** Formatos que se rechazan con una explicacion propia, no con un generico. */
export const RECHAZOS_EXPLICADOS: Record<string, string> = {
  '.xlsm':
    'Los archivos .xlsm llevan macros y no se aceptan. Abre el archivo en Excel y guárdalo como .xlsx («Libro de Excel») para importarlo.',
  '.xlsb':
    'El formato binario .xlsb no es compatible. Guarda el archivo como .xlsx e inténtalo de nuevo.',
  '.xls':
    'El formato .xls (Excel 97-2003) no es compatible. Guarda el archivo como .xlsx desde Excel e intenta de nuevo.',
  '.xltm':
    'Las plantillas con macros (.xltm) no se aceptan. Guarda el archivo como .xlsx para importarlo.',
};

export function validarArchivoDeImportacion(
  nombre: string,
  tamaño: number,
): void {
  if (!nombre || tamaño <= 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  const ext = path.extname(nombre).toLowerCase();

  const explicacion = RECHAZOS_EXPLICADOS[ext];
  if (explicacion) throw new BadRequestException(explicacion);

  if (!EXTENSIONES_PERMITIDAS.includes(ext)) {
    throw new BadRequestException(
      `Formato de archivo no permitido. Usa ${EXTENSIONES_PERMITIDAS.join(' o ')}.`,
    );
  }

  if (tamaño > MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES) {
    throw new BadRequestException(FILE_TOO_LARGE_MESSAGE);
  }
}
