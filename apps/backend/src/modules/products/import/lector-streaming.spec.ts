import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { leerEnStreaming, partirCsv, sanearCelda } from './lector-streaming';
import { validarArchivoDeImportacion } from './validacion-archivo';

/** Los archivos de prueba se generan; NUNCA se suben al repositorio. */
let carpeta: string;

beforeAll(async () => {
  carpeta = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'takto-lector-'));
});

afterAll(async () => {
  await fs.promises.rm(carpeta, { recursive: true, force: true });
});

async function escribirCsv(nombre: string, contenido: string) {
  const ruta = path.join(carpeta, nombre);
  await fs.promises.writeFile(ruta, contenido, 'utf8');
  return ruta;
}

async function escribirXlsx(
  nombre: string,
  filas: Array<Array<string | number>>,
) {
  const ruta = path.join(carpeta, nombre);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: ruta });
  const hoja = wb.addWorksheet('Productos');
  for (const f of filas) hoja.addRow(f).commit();
  hoja.commit();
  await wb.commit();
  return ruta;
}

async function recolectar(ruta: string, nombre: string, opciones = {}) {
  const filas: string[][] = [];
  const r = await leerEnStreaming(
    ruta,
    nombre,
    async (fila) => {
      filas.push(fila);
    },
    opciones,
  );
  return { ...r, filas };
}

describe('Lectura en streaming — CSV', () => {
  it('lee las filas sin cargar el archivo entero', async () => {
    const ruta = await escribirCsv(
      'basico.csv',
      'Nombre,Precio\nSilla,250000\nMesa,890000\n',
    );

    const r = await recolectar(ruta, 'basico.csv');

    expect(r.cabeceras).toEqual(['Nombre', 'Precio']);
    expect(r.filas).toEqual([
      ['Silla', '250000'],
      ['Mesa', '890000'],
    ]);
  });

  it('detecta el punto y coma, que es lo que exporta Excel en español', async () => {
    // Partir por coma dejaría todas las columnas en una sola.
    const ruta = await escribirCsv(
      'puntoycoma.csv',
      'Nombre;Precio\nSilla;250000\n',
    );

    const r = await recolectar(ruta, 'puntoycoma.csv');

    expect(r.cabeceras).toEqual(['Nombre', 'Precio']);
    expect(r.filas[0]).toEqual(['Silla', '250000']);
  });

  it('respeta las comillas: una descripción con comas no rompe las columnas', async () => {
    const ruta = await escribirCsv(
      'comillas.csv',
      'Nombre,Descripcion,Precio\n"Sala","Ratán, natural, tejido a mano",1200000\n',
    );

    const r = await recolectar(ruta, 'comillas.csv');

    expect(r.filas[0]).toEqual([
      'Sala',
      'Ratán, natural, tejido a mano',
      '1200000',
    ]);
  });

  it('una comilla escapada dentro del campo se conserva', () => {
    expect(partirCsv('"dice ""hola""",2', ',')).toEqual(['dice "hola"', '2']);
  });

  it('reanuda desde una fila concreta', async () => {
    // Es lo que hace posible que un worker reiniciado no duplique lo escrito.
    const ruta = await escribirCsv('reanudar.csv', 'Nombre\nA\nB\nC\nD\n');

    const r = await recolectar(ruta, 'reanudar.csv', { desdeFila: 3 });

    expect(r.filas).toEqual([['C'], ['D']]);
  });

  it('para cuando le piden cancelar', async () => {
    const lineas = [
      'Nombre',
      ...Array.from({ length: 1000 }, (_, i) => `P${i}`),
    ];
    const ruta = await escribirCsv('cancelar.csv', lineas.join('\n'));

    const r = await recolectar(ruta, 'cancelar.csv', { cancelado: () => true });

    expect(r.cancelada).toBe(true);
    // Se comprueba entre filas, no en cada una: para en el primer control.
    expect(r.filas.length).toBeLessThan(1000);
  });

  it('salta las líneas en blanco sin contarlas', async () => {
    const ruta = await escribirCsv('blancos.csv', 'Nombre\nA\n\n\nB\n');

    const r = await recolectar(ruta, 'blancos.csv');

    expect(r.filas).toEqual([['A'], ['B']]);
  });
});

describe('Lectura en streaming — XLSX', () => {
  it('lee un libro real fila a fila', async () => {
    const ruta = await escribirXlsx('basico.xlsx', [
      ['Nombre', 'Precio'],
      ['Silla Nórdica', 250000],
      ['Mesa Roble', 890000],
    ]);

    const r = await recolectar(ruta, 'basico.xlsx');

    expect(r.cabeceras).toEqual(['Nombre', 'Precio']);
    expect(r.filas).toEqual([
      ['Silla Nórdica', '250000'],
      ['Mesa Roble', '890000'],
    ]);
  });

  it('reanuda desde una fila concreta', async () => {
    const ruta = await escribirXlsx('reanudar.xlsx', [
      ['Nombre'],
      ['A'],
      ['B'],
      ['C'],
    ]);

    const r = await recolectar(ruta, 'reanudar.xlsx', { desdeFila: 3 });

    expect(r.filas).toEqual([['C']]);
  });
});

describe('Saneado de celdas', () => {
  /**
   * INYECCION DE FORMULAS.
   *
   * Una celda que empieza por `=` la interpreta Excel como formula al ABRIR el
   * archivo. Si ese texto entra como nombre de producto y después sale en una
   * exportación, quien abra ese CSV ejecuta lo que otro escribió.
   */
  it.each(['=SUM(A1)', '+1+1', '-1+1', '@SUM(A1)', "=cmd|' /c calc'!A1"])(
    'neutraliza el prefijo peligroso %s',
    (peligroso) => {
      expect(sanearCelda(peligroso)).toBe(`'${peligroso}`);
    },
  );

  it('un nombre normal NO se toca', () => {
    expect(sanearCelda('Silla Nórdica')).toBe('Silla Nórdica');
  });

  /**
   * `String(objeto)` produce "[object Object]".
   *
   * Una celda de Excel puede traer objetos: una fórmula con error, un
   * hipervínculo raro. Sin filtro, esa cadena acaba siendo el NOMBRE de un
   * producto en el catálogo de un cliente.
   */
  it('un objeto raro NO se convierte en "[object Object]"', () => {
    expect(sanearCelda({ error: '#REF!' })).toBe('');
    expect(sanearCelda({ text: 'Silla' })).toBe('Silla');
    expect(sanearCelda({ result: 42 })).toBe('42');
    expect(
      sanearCelda({ richText: [{ text: 'Mesa ' }, { text: 'grande' }] }),
    ).toBe('Mesa grande');
  });

  it('acota la longitud de una celda', () => {
    // Una sola celda de cien megas cabe en un XLSX de pocos kilobytes
    // comprimido, y basta una para dejar sin memoria al proceso.
    expect(sanearCelda('x'.repeat(100_000)).length).toBe(4096);
  });
});

describe('Formatos aceptados', () => {
  /**
   * `.xlsm` es el formato de Excel CON MACROS. Aquí nadie las ejecuta, pero el
   * archivo queda almacenado y acaba descargándose en el equipo de alguien,
   * donde Excel sí pregunta si quiere habilitarlas.
   */
  it('RECHAZA .xlsm y explica qué hacer', () => {
    expect(() => validarArchivoDeImportacion('catalogo.xlsm', 1000)).toThrow(
      /macros/i,
    );
  });

  it.each(['.xlsb', '.xltm', '.xls'])(
    'rechaza %s con mensaje propio',
    (ext) => {
      expect(() =>
        validarArchivoDeImportacion(`catalogo${ext}`, 1000),
      ).toThrow();
    },
  );

  it.each(['.xlsx', '.csv'])('acepta %s', (ext) => {
    expect(() =>
      validarArchivoDeImportacion(`catalogo${ext}`, 1000),
    ).not.toThrow();
  });

  it('rechaza un archivo vacío', () => {
    expect(() => validarArchivoDeImportacion('catalogo.csv', 0)).toThrow(
      /vacío/i,
    );
  });
});
