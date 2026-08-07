import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validarArchivoDeImportacion } from './validacion-archivo';
import { comprobarEspacio } from './almacenamiento-temporal';
import { MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES } from '../products-import.constants';

/**
 * El limite que se le PROMETE a alguien tiene que ser el que el servidor
 * aplica de verdad.
 *
 * La interfaz los tenia escritos a mano —50 MB, 10.000 filas y solo `.xlsx`— y
 * habian dejado de coincidir: rechazaba CSV en el navegador cuando el backend
 * ya lo importaba. Un limite duplicado a mano SIEMPRE acaba desviandose.
 */
describe('Límites de la importación', () => {
  /** La misma cuenta que hace el endpoint, aislada para poder fijarla. */
  const subidaMaxima = (producto: number, proxy: number | null) =>
    proxy ? Math.min(proxy, producto) : producto;

  it('manda el MENOR entre el límite del producto y el del proxy', () => {
    // De nada sirve ofrecer 500 MB si el proxy de delante corta en 55: la
    // subida muere antes de llegar al backend y quien la hizo ve un error de
    // red, no un mensaje.
    expect(subidaMaxima(500, 55)).toBe(55);
    expect(subidaMaxima(50, 55)).toBe(50);
    expect(subidaMaxima(500, null)).toBe(500);
  });

  it('avisa cuando es el PROXY el que limita, no el producto', () => {
    const limitado = (producto: number, proxy: number | null) =>
      !!proxy && proxy < producto;

    expect(limitado(500, 55)).toBe(true);
    expect(limitado(50, 55)).toBe(false);
    expect(limitado(500, null)).toBe(false);
  });

  /**
   * UN ARCHIVO DEMASIADO GRANDE SE RECHAZA ANTES DE OCUPAR RECURSOS.
   *
   * La comprobación mira el TAMAÑO declarado, no el contenido: no hay que
   * leerlo, ni abrirlo, ni recorrer una sola fila para decir que no cabe.
   */
  it('rechaza un archivo por encima del límite sin leerlo', () => {
    const demasiado = MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES + 1;

    expect(() =>
      validarArchivoDeImportacion('catalogo.xlsx', demasiado),
    ).toThrow(BadRequestException);
    expect(() =>
      validarArchivoDeImportacion('catalogo.xlsx', demasiado),
    ).toThrow(/tamaño máximo/i);
  });

  it('acepta uno justo en el límite', () => {
    expect(() =>
      validarArchivoDeImportacion(
        'catalogo.xlsx',
        MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES,
      ),
    ).not.toThrow();
  });

  /**
   * Y ANTES de aceptar la subida se comprueba que CABE en disco.
   *
   * Aceptar un archivo que no cabe llena el disco del servidor y se lleva por
   * delante a todo lo demás —la base, los logs, el propio producto—, no solo a
   * la importación.
   */
  it('rechaza la subida si no hay espacio en disco para ella', async () => {
    // Un tamaño absurdo: ningún disco de pruebas tiene un exabyte libre.
    await expect(comprobarEspacio(Number.MAX_SAFE_INTEGER)).rejects.toThrow(
      /espacio suficiente/i,
    );
  });

  it('deja pasar una subida de tamaño razonable', async () => {
    await expect(comprobarEspacio(1024 * 1024)).resolves.toBeUndefined();
  });

  it('la carpeta temporal se crea si no existe', async () => {
    const carpeta = path.join(os.tmpdir(), `takto-limites-${Date.now()}`);
    process.env.PRODUCT_IMPORT_TMP_DIR = carpeta;
    try {
      await comprobarEspacio(1024);
      expect(fs.existsSync(carpeta)).toBe(true);
    } finally {
      delete process.env.PRODUCT_IMPORT_TMP_DIR;
      await fs.promises.rm(carpeta, { recursive: true, force: true });
    }
  });
});
