import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import {
  MAX_COLUMNAS,
  MAX_LONGITUD_CELDA,
  MAX_PRODUCT_IMPORT_ROWS,
  RATIO_MAXIMO_DESCOMPRESION,
  TOO_MANY_ROWS_MESSAGE,
} from '../products-import.constants';

/**
 * LECTURA EN STREAMING. Ni el CSV ni el XLSX se cargan enteros en memoria.
 *
 * El lector anterior hacia `workbook.xlsx.load(buffer)`, que es el archivo
 * COMPLETO en RAM mas el arbol de objetos que exceljs construye encima. Un
 * catalogo de 200 MB eran 200 MB de RSS antes de procesar una sola fila, en un
 * VPS que no los tiene.
 *
 * Aqui las filas salen de una en una y se procesan de una en una. La memoria
 * que usa el proceso deja de depender del tamaño del archivo.
 */

/** Una fila cruda: valores por indice de columna, ya saneados. */
export type FilaCruda = string[];

export interface OpcionesDeLectura {
  /** Fila por la que empezar (1 = la primera de DATOS, sin cabecera). */
  desdeFila?: number;
  /** Se consulta entre filas. Si devuelve true, la lectura se detiene. */
  cancelado?: () => boolean | Promise<boolean>;
}

export interface ResultadoDeLectura {
  cabeceras: string[];
  /** Cuantas filas de datos se recorrieron. */
  filasLeidas: number;
  /** La lectura paro porque alguien cancelo. */
  cancelada: boolean;
}

/**
 * Neutraliza la inyeccion de formulas.
 *
 * Una celda que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro la
 * interpreta Excel como formula CUANDO SE ABRE el archivo. Si ese texto entra
 * como nombre de producto y despues sale en una exportacion, quien abra ese CSV
 * ejecuta lo que otro escribio.
 */
export function sanearCelda(valor: unknown): string {
  const texto = aTextoLegible(valor);
  const acotado = texto.slice(0, MAX_LONGITUD_CELDA);
  return /^[=+\-@\t\r]/.test(acotado) ? `'${acotado}` : acotado;
}

/**
 * A texto SOLO lo que tiene representacion legible.
 *
 * `String(objeto)` produce "[object Object]", y una celda de Excel puede traer
 * objetos: una formula con error, un hipervinculo raro, texto enriquecido. Sin
 * este filtro esa cadena acaba siendo el NOMBRE de un producto en el catalogo
 * de un cliente.
 */
function aTextoLegible(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>)
        .map((r) => r.text ?? '')
        .join('');
    }
    if ('text' in o) return aTextoLegible(o.text);
    if ('hyperlink' in o) return aTextoLegible(o.hyperlink);
    // Una formula puede devolver un objeto de error de Excel.
    if ('result' in o) return aTextoLegible(o.result);
  }
  return '';
}

/** El formato se decide por la extension, ya validada antes de llegar aqui. */
export function esCsv(nombre: string): boolean {
  return path.extname(nombre).toLowerCase() === '.csv';
}

/**
 * Recorre el archivo llamando a `porFila` una vez por cada fila de datos.
 *
 * `porFila` recibe el numero de fila (1 = la primera de datos) para que quien
 * procesa pueda guardar por donde va y reanudar ahi.
 */
export async function leerEnStreaming(
  rutaTemporal: string,
  nombreOriginal: string,
  porFila: (fila: FilaCruda, numero: number) => Promise<void>,
  opciones: OpcionesDeLectura = {},
): Promise<ResultadoDeLectura> {
  return esCsv(nombreOriginal)
    ? leerCsv(rutaTemporal, porFila, opciones)
    : leerXlsx(rutaTemporal, porFila, opciones);
}

// ── CSV ────────────────────────────────────────────────────────

/**
 * CSV linea a linea con `readline`, que no carga el archivo.
 *
 * El separador se detecta de la CABECERA: un catalogo exportado desde Excel en
 * español usa `;`, y partir por `,` dejaria todas las columnas en una sola.
 */
async function leerCsv(
  ruta: string,
  porFila: (fila: FilaCruda, numero: number) => Promise<void>,
  opciones: OpcionesDeLectura,
): Promise<ResultadoDeLectura> {
  const desde = opciones.desdeFila ?? 1;
  const flujo = fs.createReadStream(ruta, { encoding: 'utf8' });
  const lineas = readline.createInterface({
    input: flujo,
    crlfDelay: Infinity,
  });

  let cabeceras: string[] = [];
  let separador = ',';
  let numero = 0;
  let filasLeidas = 0;
  let cancelada = false;

  try {
    for await (const linea of lineas) {
      if (!cabeceras.length) {
        if (!linea.trim()) continue;
        separador = detectarSeparador(linea);
        cabeceras = partirCsv(linea, separador).map((c) => c.trim());
        if (cabeceras.length > MAX_COLUMNAS) {
          throw new BadRequestException(
            `El archivo tiene ${cabeceras.length} columnas. El máximo es ${MAX_COLUMNAS}.`,
          );
        }
        continue;
      }

      if (!linea.trim()) continue;
      numero++;

      if (numero > MAX_PRODUCT_IMPORT_ROWS) {
        throw new BadRequestException(TOO_MANY_ROWS_MESSAGE);
      }
      if (numero < desde) continue;

      // La cancelacion se consulta entre filas y no dentro del lote: parar a
      // mitad de una escritura dejaria la fila contada pero no guardada.
      if (numero % 200 === 0 && (await opciones.cancelado?.())) {
        cancelada = true;
        break;
      }

      await porFila(partirCsv(linea, separador).map(sanearCelda), numero);
      filasLeidas++;
    }
  } finally {
    lineas.close();
    flujo.destroy();
  }

  return { cabeceras, filasLeidas, cancelada };
}

function detectarSeparador(cabecera: string): string {
  const candidatos = [',', ';', '\t', '|'];
  let mejor = ',';
  let maximo = 0;
  for (const c of candidatos) {
    const n = cabecera.split(c).length;
    if (n > maximo) {
      maximo = n;
      mejor = c;
    }
  }
  return mejor;
}

/**
 * Partir una linea de CSV respetando las comillas.
 *
 * `split(separador)` a secas rompe cualquier descripcion que lleve una coma
 * dentro, que en un catalogo de muebles es practicamente todas.
 */
export function partirCsv(linea: string, separador: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Dos comillas seguidas dentro de un campo entrecomillado son una
      // comilla literal, no el fin del campo.
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
      continue;
    }
    if (c === separador && !entreComillas) {
      campos.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  campos.push(actual);
  return campos;
}

// ── XLSX ───────────────────────────────────────────────────────

/**
 * XLSX con el lector de streaming de exceljs.
 *
 * PROTECCION CONTRA ZIP BOMBS: un `.xlsx` es un ZIP, y un ZIP de pocos
 * kilobytes puede descomprimirse en gigabytes. Como aqui se lee en streaming
 * nunca hay un buffer gigante, pero el numero de FILAS si podria dispararse:
 * el tope de filas y el de columnas son los que cortan, y se comprueban
 * mientras se lee, no al final.
 */
async function leerXlsx(
  ruta: string,
  porFila: (fila: FilaCruda, numero: number) => Promise<void>,
  opciones: OpcionesDeLectura,
): Promise<ResultadoDeLectura> {
  const desde = opciones.desdeFila ?? 1;
  const tamañoComprimido = (await fs.promises.stat(ruta)).size;

  const lector = new ExcelJS.stream.xlsx.WorkbookReader(ruta, {
    // No se necesitan ni estilos ni cadenas compartidas en memoria: solo
    // valores. Es lo que hace que la memoria no dependa del tamaño.
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });

  let cabeceras: string[] = [];
  let numero = 0;
  let filasLeidas = 0;
  let cancelada = false;
  let bytesLeidos = 0;

  for await (const hoja of lector) {
    for await (const fila of hoja) {
      const valores = extraerValores(fila);

      if (!cabeceras.length) {
        cabeceras = valores.map((c) => c.trim());
        if (cabeceras.length > MAX_COLUMNAS) {
          throw new BadRequestException(
            `El archivo tiene ${cabeceras.length} columnas. El máximo es ${MAX_COLUMNAS}.`,
          );
        }
        continue;
      }

      if (valores.every((v) => !v.trim())) continue;
      numero++;

      // Zip bomb: si lo que ya se ha leido descomprimido supera con mucho al
      // archivo, es un archivo construido para reventar el proceso.
      bytesLeidos += valores.reduce((a, v) => a + v.length, 0);
      if (bytesLeidos > tamañoComprimido * RATIO_MAXIMO_DESCOMPRESION) {
        throw new BadRequestException(
          'El archivo se descomprime a un tamaño desproporcionado. Se descarta por seguridad.',
        );
      }

      if (numero > MAX_PRODUCT_IMPORT_ROWS) {
        throw new BadRequestException(TOO_MANY_ROWS_MESSAGE);
      }
      if (numero < desde) continue;

      if (numero % 200 === 0 && (await opciones.cancelado?.())) {
        cancelada = true;
        break;
      }

      await porFila(valores, numero);
      filasLeidas++;
    }
    // Solo la primera hoja: un catalogo esta en una hoja, y recorrer las demas
    // mezclaria datos que no son productos.
    break;
  }

  return { cabeceras, filasLeidas, cancelada };
}

function extraerValores(fila: ExcelJS.Row): string[] {
  const salida: string[] = [];
  // `values` de exceljs es 1-indexado y su hueco 0 no existe.
  const valores = fila.values as unknown[];
  for (let i = 1; i < Math.min(valores.length, MAX_COLUMNAS + 1); i++) {
    salida.push(sanearCelda(valores[i]));
  }
  return salida;
}
