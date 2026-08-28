import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AlmacenamientoEnDirectorioCompartido,
  avisoDeAlmacenamiento,
  claveSegura,
  generarClave,
  resolverRutaDeClave,
} from './almacenamiento-importaciones';

/**
 * EL FALLO QUE LLEGO A STAGING, REPRODUCIDO.
 *
 * El backend guardaba el archivo en SU `/tmp` y metia la ruta absoluta en la
 * base. El worker —otro contenedor, otro `/tmp`— buscaba esa ruta y no existia:
 * cada importacion moria con «El archivo temporal ya no existe» y cero filas.
 *
 * Nada lo detecto porque todas las pruebas corrian en UN proceso, donde quien
 * escribe y quien lee comparten disco. Aqui se montan DOS raices distintas a
 * proposito para que la asimetria sea visible.
 */
describe('Almacenamiento de importaciones', () => {
  let raizCompartida: string;
  let raizAjena: string;

  beforeEach(async () => {
    raizCompartida = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'takto-alm-comp-'),
    );
    raizAjena = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'takto-alm-ajena-'),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(raizCompartida, { recursive: true, force: true });
    await fs.promises.rm(raizAjena, { recursive: true, force: true });
  });

  const conContenido = async (texto: string) => {
    const ruta = path.join(raizCompartida, `origen-${Date.now()}.tmp`);
    await fs.promises.writeFile(ruta, texto, 'utf8');
    return ruta;
  };

  describe('backend y worker en procesos distintos', () => {
    it('el worker LEE lo que guardó el backend cuando comparten raíz', async () => {
      const backend = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const worker = new AlmacenamientoEnDirectorioCompartido(raizCompartida);

      const clave = await backend.guardar(
        await conContenido('Nombre,SKU\nSilla,S-1\n'),
        'catalogo.csv',
      );

      // El worker solo recibe la CLAVE, igual que la recibe por la cola.
      expect(await worker.existe(clave)).toBe(true);
      const leido = await fs.promises.readFile(
        worker.rutaFisica(clave),
        'utf8',
      );
      expect(leido).toContain('Silla,S-1');
    });

    /**
     * ESTA ES LA PRUEBA QUE HABRIA PARADO EL FALLO.
     *
     * Con raices distintas —que es lo que son dos `/tmp` de dos contenedores—
     * el worker NO encuentra el archivo. Si alguien vuelve a configurar mal el
     * volumen, esto lo dice.
     */
    it('con raíces DISTINTAS el worker no encuentra nada: el fallo de staging', async () => {
      const backend = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const workerAislado = new AlmacenamientoEnDirectorioCompartido(raizAjena);

      const clave = await backend.guardar(
        await conContenido('Nombre,SKU\nSilla,S-1\n'),
        'catalogo.csv',
      );

      expect(await backend.existe(clave)).toBe(true);
      expect(await workerAislado.existe(clave)).toBe(false);
    });

    it('la clave no depende del `/tmp` del proceso', async () => {
      const backend = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const clave = await backend.guardar(
        await conContenido('x'),
        'catalogo.csv',
      );

      // Ni rastro de una ruta absoluta: lo que viaja es un nombre plano.
      expect(clave).not.toContain(path.sep);
      expect(path.isAbsolute(clave)).toBe(false);
      expect(clave).not.toContain(os.tmpdir());
    });
  });

  describe('claves seguras', () => {
    it('genera un nombre propio y conserva solo la extensión conocida', () => {
      expect(generarClave('catálogo de precios.csv')).toMatch(/\.csv$/);
      expect(generarClave('catalogo.xlsx')).toMatch(/\.xlsx$/);
      // Una extensión que el lector no entiende no se propaga.
      expect(generarClave('virus.exe')).toMatch(/\.dat$/);
      expect(generarClave('')).toMatch(/\.dat$/);
    });

    it('el nombre del cliente NUNCA decide dónde se escribe', () => {
      const clave = generarClave('../../../etc/passwd.csv');
      expect(clave).not.toContain('..');
      expect(clave).not.toContain('/');
      expect(claveSegura(clave)).toBe(true);
    });

    it.each([
      ['../fuera.csv', 'salto de directorio'],
      ['../../etc/passwd', 'traversal profundo'],
      ['/etc/passwd', 'ruta absoluta'],
      ['sub/dir.csv', 'con separador'],
      ['sub\\dir.csv', 'separador de Windows'],
      ['', 'vacía'],
      ['catalogo.csv', 'nombre no generado por el servidor'],
    ])('rechaza la clave %s (%s)', (clave) => {
      expect(claveSegura(clave)).toBe(false);
    });

    it('resolver una clave insegura lanza 400, no escribe fuera', () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      expect(() => alm.rutaFisica('../fuera.csv')).toThrow(BadRequestException);
      expect(() => alm.rutaFisica('/etc/passwd')).toThrow(BadRequestException);
    });

    it('una clave insegura no borra nada ni finge que existe', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      expect(await alm.existe('../fuera.csv')).toBe(false);
      await expect(alm.eliminar('../fuera.csv')).resolves.toBeUndefined();
      expect(await alm.metadatos('../fuera.csv')).toBeNull();
    });
  });

  // El controlador de subida usa este helper (no `file.path`) para leer y borrar
  // el archivo. Es la barrera de path-injection que cierra la alerta de CodeQL:
  // la ruta se construye desde una raíz controlada por el servidor + la clave
  // generada por el servidor, resuelta canónicamente y confinada a la raíz.
  describe('resolverRutaDeClave (path-injection)', () => {
    it('una clave legítima (CSV/XLSX) resuelve DENTRO de la raíz', () => {
      for (const ext of ['.csv', '.xlsx']) {
        const clave = generarClave(`catalogo${ext}`);
        const ruta = resolverRutaDeClave(clave, raizCompartida);
        expect(path.isAbsolute(ruta)).toBe(true);
        expect(ruta.startsWith(path.resolve(raizCompartida) + path.sep)).toBe(
          true,
        );
        expect(path.dirname(ruta)).toBe(path.resolve(raizCompartida));
        expect(path.basename(ruta)).toBe(clave);
      }
    });

    it.each([
      ['../fuera.csv', 'salto de directorio'],
      ['../../etc/passwd', 'traversal profundo'],
      ['/etc/passwd', 'ruta absoluta POSIX'],
      ['C:\\Windows\\win.ini', 'ruta absoluta Windows'],
      ['sub/otro.csv', 'con separador'],
      ['sub\\otro.csv', 'separador de Windows'],
      ['con\0nulo.csv', 'byte nulo'],
      ['catalogo.csv', 'nombre del cliente, no generado por el servidor'],
      ['', 'vacía'],
    ])('rechaza %s (%s) con 400 y no escapa de la raíz', (clave) => {
      expect(() => resolverRutaDeClave(clave, raizCompartida)).toThrow(
        BadRequestException,
      );
    });

    it('ni siquiera una clave con separador que "empieza por" la raíz escapa', () => {
      // Defensa en profundidad: aunque el prefijo textual coincidiera, la clave
      // lleva separadores y `claveSegura` la rechaza antes de resolver.
      const clave = `${path.basename(raizCompartida)}-hermana/x.csv`;
      expect(() => resolverRutaDeClave(clave, raizCompartida)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('escritura atómica', () => {
    it('no deja un `.partial` cuando termina bien', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const clave = await alm.guardar(await conContenido('x'), 'c.csv');

      const restos = (await fs.promises.readdir(raizCompartida)).filter((f) =>
        f.endsWith('.partial'),
      );
      expect(restos).toHaveLength(0);
      expect(await alm.existe(clave)).toBe(true);
    });

    it('un origen que no existe no publica un archivo a medias', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      await expect(
        alm.guardar(path.join(raizCompartida, 'no-existe.csv'), 'c.csv'),
      ).rejects.toThrow();

      const restos = await fs.promises.readdir(raizCompartida);
      expect(restos.filter((f) => f.endsWith('.partial'))).toHaveLength(0);
      expect(restos.filter((f) => f.endsWith('.csv'))).toHaveLength(0);
    });
  });

  describe('borrado y limpieza', () => {
    it('eliminar es idempotente', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const clave = await alm.guardar(await conContenido('x'), 'c.csv');

      await alm.eliminar(clave);
      expect(await alm.existe(clave)).toBe(false);
      // Borrar lo ya borrado no es un error.
      await expect(alm.eliminar(clave)).resolves.toBeUndefined();
    });

    it('metadatos sin exponer la ruta', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const clave = await alm.guardar(await conContenido('hola'), 'c.csv');

      const meta = await alm.metadatos(clave);
      expect(meta).not.toBeNull();
      expect(meta!.clave).toBe(clave);
      expect(meta!.tamaño).toBe(4);
      expect(JSON.stringify(meta)).not.toContain(raizCompartida);
    });

    it('barre los huérfanos viejos y respeta los recientes', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(raizCompartida);
      const viejo = await alm.guardar(await conContenido('viejo'), 'v.csv');
      const nuevo = await alm.guardar(await conContenido('nuevo'), 'n.csv');

      // El «viejo» se envejece a mano en vez de esperar un día.
      const hace2h = new Date(Date.now() - 2 * 60 * 60_000);
      await fs.promises.utimes(alm.rutaFisica(viejo), hace2h, hace2h);

      const { borrados } = await alm.limpiarHuerfanos(60 * 60_000);

      expect(borrados).toBe(1);
      expect(await alm.existe(viejo)).toBe(false);
      // Uno reciente podría pertenecer a una importación que aún se reintenta.
      expect(await alm.existe(nuevo)).toBe(true);
    });

    it('barrer un directorio inexistente no explota', async () => {
      const alm = new AlmacenamientoEnDirectorioCompartido(
        path.join(raizCompartida, 'no-creado'),
      );
      await expect(alm.limpiarHuerfanos()).resolves.toEqual({ borrados: 0 });
    });
  });

  describe('aviso de configuración', () => {
    it('avisa en producción cuando no hay directorio configurado', () => {
      expect(avisoDeAlmacenamiento({ NODE_ENV: 'production' })).toMatch(
        /PRODUCT_IMPORT_STORAGE_DIR/,
      );
    });

    it('calla cuando está configurado', () => {
      expect(
        avisoDeAlmacenamiento({
          NODE_ENV: 'production',
          PRODUCT_IMPORT_STORAGE_DIR: '/var/lib/takto/importaciones',
        }),
      ).toBeNull();
    });

    it('calla en desarrollo, donde backend y worker son el mismo proceso', () => {
      expect(avisoDeAlmacenamiento({ NODE_ENV: 'development' })).toBeNull();
    });
  });
});
