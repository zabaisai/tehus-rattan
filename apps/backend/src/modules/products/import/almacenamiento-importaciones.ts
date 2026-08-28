import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

/**
 * DONDE VIVE EL ARCHIVO DE UNA IMPORTACION MIENTRAS SE PROCESA.
 *
 * EL FALLO QUE ESTO ARREGLA
 *
 * El backend guardaba el archivo en `/tmp` y metia la RUTA ABSOLUTA en la base;
 * despues encolaba el trabajo y lo consumia el WORKER, que es otro contenedor
 * con su propio `/tmp`. La ruta existia, pero solo en el proceso equivocado, y
 * cada importacion moria con «El archivo temporal ya no existe» y cero filas.
 *
 * Ninguna prueba lo detecto porque todas —unitarias, E2E y hasta la de 500 MB—
 * corren en UN proceso, donde quien escribe y quien lee comparten disco. El
 * fallo solo existe cuando productor y consumidor son contenedores distintos.
 *
 * QUE CAMBIA
 *
 * La base deja de guardar una ruta absoluta y guarda una CLAVE RELATIVA que
 * genera el servidor. Resolverla a una ruta real es responsabilidad de este
 * modulo, y cada proceso la resuelve contra SU raiz configurada —que en Docker
 * es el mismo volumen montado en el mismo sitio en backend y worker—.
 *
 * Guardar una clave y no una ruta tiene una segunda ventaja: el dia que esto
 * pase a almacenamiento de objetos, la clave ya es lo unico que hace falta y el
 * motor de importacion no se entera del cambio.
 */
/**
 * Token de inyección.
 *
 * Se inyecta por token y no por clase para que sustituir el proveedor —por
 * almacenamiento de objetos, por uno falso en pruebas— sea cambiar una línea
 * del módulo y nada más.
 */
export const ALMACENAMIENTO_DE_IMPORTACIONES = Symbol(
  'ALMACENAMIENTO_DE_IMPORTACIONES',
);

export interface MetadatosDeArchivo {
  clave: string;
  tamaño: number;
  modificadoEn: Date;
}

export interface AlmacenamientoDeImportaciones {
  /**
   * Guarda un archivo y devuelve su clave.
   *
   * El nombre lo genera el servidor. El original solo aporta la extension, y
   * acotada a una lista: un `../../etc/passwd` como nombre de archivo no puede
   * decidir donde se escribe.
   */
  guardar(origen: Readable | string, nombreOriginal: string): Promise<string>;
  /** Stream de lectura. Falla si la clave no existe. */
  abrirLectura(clave: string): Promise<Readable>;
  existe(clave: string): Promise<boolean>;
  /** Idempotente: borrar lo ya borrado no es un error. */
  eliminar(clave: string): Promise<void>;
  metadatos(clave: string): Promise<MetadatosDeArchivo | null>;
  /** Borra lo que quedo huerfano. Idempotente. */
  limpiarHuerfanos(
    edadMinimaMs?: number,
    ahora?: number,
  ): Promise<{ borrados: number }>;
  /**
   * Ruta real de la clave, SOLO para quien necesite un descriptor de fichero.
   *
   * El lector en streaming abre el archivo por ruta —`ExcelJS` la necesita— y
   * por eso existe. No se expone nunca al cliente ni se guarda en la base.
   */
  rutaFisica(clave: string): string;
}

/** Extensiones que el lector sabe interpretar. Lo demas no se acepta. */
const EXTENSIONES = ['.xlsx', '.csv'];

/**
 * Raiz del almacenamiento.
 *
 * `PRODUCT_IMPORT_STORAGE_DIR` es la que manda. `PRODUCT_IMPORT_TMP_DIR` se
 * sigue leyendo por compatibilidad con lo que ya habia desplegado, y el
 * `os.tmpdir()` final solo aplica en desarrollo local, donde backend y worker
 * son el mismo proceso.
 *
 * EN DOCKER LAS DOS PRIMERAS APUNTAN AL VOLUMEN COMPARTIDO. Dejar que caiga al
 * tmpdir en produccion es exactamente el fallo que esto arregla, y por eso
 * `verificarAlmacenamientoCompartido` avisa al arrancar.
 */
export function carpetaDeAlmacenamiento(): string {
  return (
    process.env.PRODUCT_IMPORT_STORAGE_DIR?.trim() ||
    process.env.PRODUCT_IMPORT_TMP_DIR?.trim() ||
    path.join(os.tmpdir(), 'takto-importaciones')
  );
}

/**
 * Una clave valida es un nombre de archivo plano generado por nosotros.
 *
 * Se comprueba ADEMAS de generarla nosotros, porque la clave viaja por la base
 * y vuelve: si alguna vez alguien escribiera ahi `../../../etc/passwd`, esto lo
 * para antes de tocar el disco. Comprobar solo al escribir deja la lectura
 * abierta.
 */
const CLAVE_VALIDA = /^[a-z0-9]+-[a-f0-9]{16}\.(xlsx|csv|dat)$/;

export function claveSegura(clave: string): boolean {
  if (!clave || clave.length > 128) return false;
  if (clave.includes('/') || clave.includes('\\') || clave.includes('\0')) {
    return false;
  }
  if (clave.includes('..')) return false;
  if (path.isAbsolute(clave)) return false;
  // `basename` no puede diferir de la clave si esta no lleva separadores; se
  // exige igualdad de forma explícita para que un separador de plataforma que
  // se nos escapara no pueda convertir la clave en una ruta con directorios.
  if (path.basename(clave) !== clave) return false;
  return CLAVE_VALIDA.test(clave);
}

function exigirClave(clave: string): void {
  if (!claveSegura(clave)) {
    throw new BadRequestException('La referencia del archivo no es válida.');
  }
}

/**
 * Convierte una CLAVE en su ruta física dentro de `raiz`, canónicamente y de
 * forma segura. Es la ÚNICA manera admitida de obtener una ruta a partir de una
 * clave: NUNCA se construye una ruta con datos del cliente (`originalname`, la
 * `file.path` absoluta del contenedor, etc.).
 *
 * Rechaza claves con separadores, `..`, nulos, absolutas o que no casen el
 * patrón (`claveSegura` → `exigirClave`), y además verifica que la ruta ya
 * resuelta cae DENTRO de la raíz resuelta. Esa comprobación de contención sobre
 * `path.resolve` es la barrera que neutraliza el path-injection: aunque la clave
 * llegara manipulada, no puede apuntar fuera del directorio permitido.
 */
export function resolverRutaDeClave(
  clave: string,
  raiz: string = carpetaDeAlmacenamiento(),
): string {
  exigirClave(clave);
  const raizResuelta = path.resolve(raiz);
  const completa = path.resolve(raizResuelta, clave);
  if (
    completa !== raizResuelta &&
    !completa.startsWith(raizResuelta + path.sep)
  ) {
    throw new BadRequestException('La referencia del archivo no es válida.');
  }
  return completa;
}

export function extensionSegura(nombre: string): string {
  const ext = path.extname(nombre || '').toLowerCase();
  return EXTENSIONES.includes(ext) ? ext : '.dat';
}

/** Nombre interno. Nunca deriva del que envió el cliente. */
export function generarClave(nombreOriginal: string): string {
  const ext = extensionSegura(nombreOriginal);
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

/**
 * Proveedor sobre un directorio compartido.
 *
 * Es lo que hay hoy: un volumen de Docker montado en la misma ruta en backend y
 * worker. La interfaz de arriba es lo que permitira cambiarlo por almacenamiento
 * de objetos sin tocar el motor de importacion.
 */
export class AlmacenamientoEnDirectorioCompartido implements AlmacenamientoDeImportaciones {
  constructor(private readonly raiz: string = carpetaDeAlmacenamiento()) {}

  rutaFisica(clave: string): string {
    // Fuente única: la misma resolución canónica + contención que usa el
    // controlador al leer/borrar la subida (ver `resolverRutaDeClave`).
    return resolverRutaDeClave(clave, this.raiz);
  }

  private async asegurarRaiz(): Promise<void> {
    await fs.promises.mkdir(this.raiz, { recursive: true });
  }

  /**
   * Escritura a un `.partial` y rename atomico.
   *
   * Sin esto, un fallo a mitad de la escritura deja un archivo truncado con el
   * nombre definitivo, y el worker lo procesaria creyendo que esta completo:
   * medio catalogo importado y ningun error. Con el rename, o esta entero o no
   * esta.
   */
  async guardar(
    origen: Readable | string,
    nombreOriginal: string,
  ): Promise<string> {
    await this.asegurarRaiz();
    const clave = generarClave(nombreOriginal);
    const destino = this.rutaFisica(clave);
    const parcial = `${destino}.partial`;

    try {
      if (typeof origen === 'string') {
        await fs.promises.copyFile(origen, parcial);
      } else {
        await new Promise<void>((resolver, rechazar) => {
          const salida = fs.createWriteStream(parcial);
          origen.on('error', rechazar);
          salida.on('error', rechazar);
          salida.on('finish', resolver);
          origen.pipe(salida);
        });
      }
      await fs.promises.rename(parcial, destino);
    } catch (error) {
      await fs.promises.unlink(parcial).catch(() => undefined);
      throw error;
    }

    return clave;
  }

  async abrirLectura(clave: string): Promise<Readable> {
    const ruta = this.rutaFisica(clave);
    await fs.promises.access(ruta, fs.constants.R_OK);
    return fs.createReadStream(ruta);
  }

  async existe(clave: string): Promise<boolean> {
    if (!claveSegura(clave)) return false;
    try {
      const info = await fs.promises.stat(this.rutaFisica(clave));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async eliminar(clave: string): Promise<void> {
    if (!claveSegura(clave)) return;
    await fs.promises.unlink(this.rutaFisica(clave)).catch(() => undefined);
    // El `.partial` de una escritura que murio a mitad tambien sobra.
    await fs.promises
      .unlink(`${this.rutaFisica(clave)}.partial`)
      .catch(() => undefined);
  }

  async metadatos(clave: string): Promise<MetadatosDeArchivo | null> {
    if (!claveSegura(clave)) return null;
    try {
      const info = await fs.promises.stat(this.rutaFisica(clave));
      if (!info.isFile()) return null;
      return { clave, tamaño: info.size, modificadoEn: info.mtime };
    } catch {
      return null;
    }
  }

  /**
   * Borra lo que lleva demasiado tiempo sin tocarse.
   *
   * Un worker que muere a mitad deja su archivo para siempre. La edad minima
   * por defecto es generosa a proposito: borrar el archivo de una importacion
   * que aun podria reintentarse seria peor que ocupar disco un dia mas.
   */
  async limpiarHuerfanos(
    edadMinimaMs = 24 * 60 * 60_000,
    ahora = Date.now(),
  ): Promise<{ borrados: number }> {
    let borrados = 0;
    const entradas = await fs.promises
      .readdir(this.raiz)
      .catch(() => [] as string[]);

    for (const nombre of entradas) {
      const completa = path.join(this.raiz, nombre);
      try {
        const info = await fs.promises.stat(completa);
        if (!info.isFile()) continue;
        if (ahora - info.mtimeMs < edadMinimaMs) continue;
        await fs.promises.unlink(completa);
        borrados++;
      } catch {
        // Que desaparezca entre el listado y el borrado no es un problema:
        // alguien ya lo limpio. Por eso esto es idempotente.
      }
    }

    return { borrados };
  }
}

/**
 * Aviso al arrancar si el almacenamiento NO parece compartido.
 *
 * No tumba el proceso: en desarrollo local el tmpdir es correcto porque backend
 * y worker son el mismo proceso. Pero en un despliegue con worker aparte, caer
 * al tmpdir es justo el fallo que costo una importacion entera en staging, y
 * eso tiene que verse en el arranque y no cuando alguien sube un catalogo.
 */
export function avisoDeAlmacenamiento(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configurada =
    env.PRODUCT_IMPORT_STORAGE_DIR?.trim() ||
    env.PRODUCT_IMPORT_TMP_DIR?.trim();
  if (configurada) return null;
  if (env.NODE_ENV !== 'production') return null;
  return (
    'PRODUCT_IMPORT_STORAGE_DIR no está configurada: las importaciones usarán ' +
    'el directorio temporal del proceso. Si el worker corre en otro contenedor, ' +
    'no podrá leer los archivos que suba el backend.'
  );
}
