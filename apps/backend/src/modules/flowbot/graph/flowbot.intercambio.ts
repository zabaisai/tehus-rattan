import { createHash } from 'crypto';
import {
  CATALOGO,
  GrafoFlow,
  LIMITES,
  NodoFlow,
  TipoNodo,
  VERSION_ESQUEMA_GRAFO,
} from './flowbot.graph';

/**
 * FORMATO DE INTERCAMBIO DE PULSOS (`.taktoflow.json`).
 *
 * Un bot exportado tiene que poder abrirse en OTRA empresa. Eso obliga a dos
 * cosas que no son negociables:
 *
 * 1. NADA de secretos. Un token de WhatsApp dentro de un archivo que la gente
 *    se manda por correo es una fuga esperando a ocurrir.
 * 2. NADA de identificadores de la empresa de origen. Un `assignedTo` que
 *    apunta a un usuario que en el destino no existe —o peor, que existe y es
 *    otra persona— asigna trabajo a quien no debe. Se sustituyen por
 *    REQUISITOS que el destino resuelve al importar.
 *
 * Lo que se exporta es la FORMA del bot: sus nodos, sus conexiones y su
 * configuracion no sensible.
 */
export const FORMATO_INTERCAMBIO = 'taktoflow';
export const VERSION_INTERCAMBIO = 1;

/** Extension oficial. `.json` a secas tambien se acepta al importar. */
export const EXTENSION_INTERCAMBIO = '.taktoflow.json';

/**
 * Referencias que NO viajan nunca con su valor.
 *
 * `credential` y `whatsappIntegration` son la puerta a un secreto; el resto
 * son identificadores de la empresa de origen que en el destino significan
 * otra cosa o nada.
 */
const REFERENCIAS_QUE_NO_VIAJAN = new Set([
  'credential',
  'whatsappIntegration',
  'user',
  'pipeline',
  'stage',
  'template',
  'customField',
]);

/** Un requisito que el destino tiene que resolver antes de poder publicar. */
export interface RequisitoDeImportacion {
  nodeId: string;
  campo: string;
  tipo: string;
  /** Etiqueta del nodo, para que la pantalla diga dónde hay que mirar. */
  nodo: string;
}

export interface SobreDeIntercambio {
  formato: typeof FORMATO_INTERCAMBIO;
  schemaVersion: number;
  metadatos: {
    nombre: string;
    descripcion: string | null;
    exportadoEn: string;
    /** Version del PRODUCTO que exporto. Informativa. */
    generadoPor: string;
  };
  grafo: GrafoFlow;
  /** Variables que el bot usa. Informativo para quien importa. */
  variables: string[];
  /** Lo que hay que volver a conectar en el destino. */
  requisitos: RequisitoDeImportacion[];
  /**
   * Huella del grafo. Detecta que el archivo se edito a mano entre exportar e
   * importar; NO es una firma: no autentica a nadie y no se usa como control
   * de seguridad, solo para avisar.
   */
  checksum: string;
}

/** Errores de un archivo que no se puede aceptar. */
export class ArchivoDeIntercambioInvalido extends Error {
  constructor(
    message: string,
    readonly detalles: string[] = [],
  ) {
    super(message);
    this.name = 'ArchivoDeIntercambioInvalido';
  }
}

// ── EXPORTAR ───────────────────────────────────────────────────

/**
 * Deja el grafo listo para salir: sin secretos y sin ids de la empresa.
 *
 * Los campos sensibles se VACIAN y se anotan como requisito. Borrarlos sin
 * dejar rastro haria que el bot importado pareciera completo y fallara al
 * publicarse, que es peor que decirlo.
 */
export function sanearParaExportar(grafo: GrafoFlow): {
  grafo: GrafoFlow;
  requisitos: RequisitoDeImportacion[];
} {
  const requisitos: RequisitoDeImportacion[] = [];

  const nodes: NodoFlow[] = grafo.nodes.map((nodo) => {
    const definicion = CATALOGO[nodo.type];
    if (!definicion || !nodo.config) return { ...nodo };

    const config: Record<string, unknown> = { ...nodo.config };

    for (const campo of definicion.config ?? []) {
      if (
        campo.tipo !== 'referencia' ||
        !campo.referencia ||
        !REFERENCIAS_QUE_NO_VIAJAN.has(campo.referencia)
      ) {
        continue;
      }
      if (config[campo.nombre] === undefined) continue;

      delete config[campo.nombre];
      requisitos.push({
        nodeId: nodo.id,
        campo: campo.nombre,
        tipo: campo.referencia,
        nodo: nodo.label || definicion.etiqueta,
      });
    }

    return { ...nodo, config };
  });

  return { grafo: { ...grafo, nodes }, requisitos };
}

export function huellaDelGrafo(grafo: GrafoFlow): string {
  // Se ordena antes de sumar: dos exportaciones del mismo bot tienen que dar
  // la misma huella aunque el orden de los nodos cambie.
  const estable = JSON.stringify({
    startNodeId: grafo.startNodeId,
    nodes: [...grafo.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => ({ id: n.id, type: n.type, config: n.config ?? {} })),
    edges: [...grafo.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to })),
  });
  return createHash('sha256').update(estable).digest('hex').slice(0, 32);
}

export function construirSobre(entrada: {
  nombre: string;
  descripcion: string | null;
  grafo: GrafoFlow;
  variables: string[];
  ahora: Date;
  version: string;
}): SobreDeIntercambio {
  const { grafo, requisitos } = sanearParaExportar(entrada.grafo);
  return {
    formato: FORMATO_INTERCAMBIO,
    schemaVersion: VERSION_INTERCAMBIO,
    metadatos: {
      nombre: entrada.nombre,
      descripcion: entrada.descripcion,
      exportadoEn: entrada.ahora.toISOString(),
      generadoPor: entrada.version,
    },
    grafo,
    variables: entrada.variables,
    requisitos,
    checksum: huellaDelGrafo(grafo),
  };
}

// ── IMPORTAR ───────────────────────────────────────────────────

/** Tope de tamaño del archivo. Un JSON mayor que esto no es un bot. */
export const MAX_BYTES_IMPORTACION = 2 * 1024 * 1024;

/** Profundidad máxima de anidamiento en `config`. */
export const MAX_PROFUNDIDAD_JSON = 12;

/**
 * Claves que NUNCA se copian de un objeto entrante.
 *
 * `__proto__`, `constructor` y `prototype` en un JSON son el vector clasico de
 * contaminacion de prototipo: un objeto con `__proto__` puede cambiar el
 * comportamiento de TODOS los objetos del proceso, no solo del suyo.
 */
const CLAVES_PROHIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ResultadoDeAnalisis {
  sobre: SobreDeIntercambio;
  /** Nodos cuyo tipo este producto no conoce. */
  nodosDesconocidos: Array<{ id: string; type: string }>;
  /** Avisos que NO impiden importar. */
  avisos: string[];
  /** El checksum del archivo coincide con su grafo. */
  checksumCoincide: boolean;
  /** Mapa id-original -> id-nuevo. Se reasignan SIEMPRE. */
  remapeo: Record<string, string>;
}

/**
 * Analiza un archivo entrante. NO escribe nada: es lo que alimenta la vista
 * previa.
 *
 * Lo que llega es texto de fuera. Se valida entero antes de mirar su
 * contenido: sin JSON Schema explícito, pero con las mismas comprobaciones que
 * uno haría, y con topes duros en tamaño, profundidad y cantidad.
 */
export function analizarImportacion(
  crudo: string,
  nuevoId: (semilla: string) => string,
): ResultadoDeAnalisis {
  if (crudo.length > MAX_BYTES_IMPORTACION) {
    throw new ArchivoDeIntercambioInvalido(
      `El archivo supera el tamaño máximo (${Math.round(MAX_BYTES_IMPORTACION / 1024)} KB).`,
    );
  }

  let datos: unknown;
  try {
    // `JSON.parse` no ejecuta nada: no hay eval, ni funciones, ni código. Un
    // `.taktoflow.json` es datos y solo datos.
    datos = JSON.parse(crudo);
  } catch {
    throw new ArchivoDeIntercambioInvalido('El archivo no es un JSON válido.');
  }

  if (!esObjeto(datos)) {
    throw new ArchivoDeIntercambioInvalido(
      'El archivo no tiene la forma de un Pulso exportado.',
    );
  }

  const errores: string[] = [];
  const sobre = datos;

  if (sobre.formato !== FORMATO_INTERCAMBIO) {
    // No se promete compatibilidad con «cualquier JSON». Un formato ajeno se
    // rechaza en vez de intentar adivinarlo, porque adivinar mal produce un
    // bot que parece bien y se comporta de otra forma.
    throw new ArchivoDeIntercambioInvalido(
      'Este archivo no es un Pulso exportado desde TAKTO. Solo se aceptan archivos .taktoflow.json.',
    );
  }

  const version = Number(sobre.schemaVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new ArchivoDeIntercambioInvalido(
      'El archivo no dice qué versión de formato usa.',
    );
  }
  if (version > VERSION_INTERCAMBIO) {
    throw new ArchivoDeIntercambioInvalido(
      `El archivo viene de una versión más nueva del producto (formato ${version}). Actualiza antes de importarlo.`,
    );
  }

  const grafoCrudo = sobre.grafo;
  if (!esObjeto(grafoCrudo)) {
    throw new ArchivoDeIntercambioInvalido('El archivo no trae ningún grafo.');
  }

  const profundidad = profundidadDe(grafoCrudo);
  if (profundidad > MAX_PROFUNDIDAD_JSON) {
    throw new ArchivoDeIntercambioInvalido(
      `La configuración está anidada demasiado hondo (${profundidad} niveles).`,
    );
  }

  const g = grafoCrudo;
  const nodosCrudos = Array.isArray(g.nodes) ? g.nodes : null;
  const aristasCrudas = Array.isArray(g.edges) ? g.edges : null;

  if (!nodosCrudos || !aristasCrudas) {
    throw new ArchivoDeIntercambioInvalido(
      'El grafo no trae nodos o conexiones.',
    );
  }
  if (nodosCrudos.length === 0) {
    throw new ArchivoDeIntercambioInvalido('El grafo no tiene ningún nodo.');
  }
  if (nodosCrudos.length > LIMITES.MAX_NODOS) {
    throw new ArchivoDeIntercambioInvalido(
      `Demasiados nodos (${nodosCrudos.length}). El máximo es ${LIMITES.MAX_NODOS}.`,
    );
  }
  if (aristasCrudas.length > LIMITES.MAX_CONEXIONES) {
    throw new ArchivoDeIntercambioInvalido(
      `Demasiadas conexiones (${aristasCrudas.length}). El máximo es ${LIMITES.MAX_CONEXIONES}.`,
    );
  }

  // ── remapeo de ids ───────────────────────────────────────────
  //
  // SIEMPRE se reasignan. Conservar los del origen invita a colisiones con
  // bots que ya existen aquí, y un id repetido hace que dos bots distintos se
  // pisen en cuanto alguien los edite.
  const remapeo: Record<string, string> = Object.create(null);
  for (const n of nodosCrudos) {
    if (!esObjeto(n) || typeof n.id !== 'string') {
      throw new ArchivoDeIntercambioInvalido('Hay un nodo sin identificador.');
    }
    const idOriginal = n.id;
    if (remapeo[idOriginal]) {
      throw new ArchivoDeIntercambioInvalido(
        `El grafo trae dos nodos con el mismo identificador (${idOriginal}).`,
      );
    }
    remapeo[idOriginal] = nuevoId('n');
  }

  const nodosDesconocidos: Array<{ id: string; type: string }> = [];
  const nodes: NodoFlow[] = nodosCrudos.map((n) => {
    const crudoNodo = n as Record<string, unknown>;
    const tipo = textoSeguro(crudoNodo.type);
    if (!(tipo in CATALOGO)) {
      nodosDesconocidos.push({ id: String(crudoNodo.id), type: tipo });
    }
    const posicion = esObjeto(crudoNodo.position) ? crudoNodo.position : {};

    return {
      id: remapeo[String(crudoNodo.id)],
      type: tipo as TipoNodo,
      position: {
        x: Number(posicion.x) || 0,
        y: Number(posicion.y) || 0,
      },
      ...(typeof crudoNodo.label === 'string'
        ? { label: crudoNodo.label.slice(0, 120) }
        : {}),
      config: limpiarObjeto(crudoNodo.config),
    };
  });

  const avisos: string[] = [];
  const edges = aristasCrudas
    .filter((e) => esObjeto(e))
    .map((e) => e)
    .filter((e) => {
      const ok =
        typeof e.from === 'string' &&
        typeof e.to === 'string' &&
        remapeo[e.from] &&
        remapeo[e.to];
      if (!ok) {
        // Una conexión que apunta a un nodo inexistente se descarta con aviso.
        // Importarla dejaría un grafo que no se puede validar y el editor se
        // abriría roto.
        avisos.push(
          'Se descartó una conexión que apuntaba a un nodo que no existe en el archivo.',
        );
      }
      return ok;
    })
    .map((e) => ({
      id: nuevoId('e'),
      from: remapeo[e.from as string],
      fromPort: textoSeguro(e.fromPort, 'next').slice(0, 40),
      to: remapeo[e.to as string],
    }));

  const startOriginal = typeof g.startNodeId === 'string' ? g.startNodeId : '';
  const startNodeId = remapeo[startOriginal] ?? nodes[0].id;
  if (!remapeo[startOriginal]) {
    avisos.push(
      'El archivo no decía por qué nodo empieza; se usará el primero.',
    );
  }

  if (nodosDesconocidos.length > 0) {
    avisos.push(
      `Hay ${nodosDesconocidos.length} nodo(s) de un tipo que este producto no conoce. Se importan, pero habrá que revisarlos antes de publicar.`,
    );
  }

  const grafo: GrafoFlow = {
    schemaVersion: VERSION_ESQUEMA_GRAFO,
    startNodeId,
    nodes,
    edges,
  };

  // El checksum se compara contra el grafo TAL COMO VENÍA, no contra el
  // remapeado: la huella describe el archivo, no el resultado de importarlo.
  const checksumEsperado =
    typeof sobre.checksum === 'string' ? sobre.checksum : '';
  const grafoOriginal: GrafoFlow = {
    schemaVersion: VERSION_ESQUEMA_GRAFO,
    startNodeId: startOriginal,
    nodes: nodosCrudos.map((n) => {
      const c = n as Record<string, unknown>;
      return {
        id: textoSeguro(c.id),
        type: textoSeguro(c.type) as TipoNodo,
        position: { x: 0, y: 0 },
        config: limpiarObjeto(c.config),
      };
    }),
    edges: aristasCrudas
      .filter((e) => esObjeto(e))
      .map((e) => {
        const c = e;
        return {
          id: textoSeguro(c.id),
          from: textoSeguro(c.from),
          fromPort: textoSeguro(c.fromPort, 'next'),
          to: textoSeguro(c.to),
        };
      }),
  };
  const checksumCoincide =
    !!checksumEsperado && huellaDelGrafo(grafoOriginal) === checksumEsperado;
  if (checksumEsperado && !checksumCoincide) {
    avisos.push(
      'El archivo fue modificado después de exportarse. Puedes importarlo igualmente, pero revísalo.',
    );
  }

  if (errores.length > 0) {
    throw new ArchivoDeIntercambioInvalido(
      'El archivo tiene errores.',
      errores,
    );
  }

  return {
    sobre: {
      formato: FORMATO_INTERCAMBIO,
      schemaVersion: version,
      metadatos: {
        nombre: nombreSeguro(sobre.metadatos),
        descripcion: descripcionSegura(sobre.metadatos),
        exportadoEn: fechaSegura(sobre.metadatos),
        generadoPor: 'desconocido',
      },
      grafo,
      variables: Array.isArray(sobre.variables)
        ? sobre.variables.filter((v) => typeof v === 'string').slice(0, 100)
        : [],
      requisitos: Array.isArray(sobre.requisitos)
        ? (
            sobre.requisitos.filter(
              esObjeto,
            ) as unknown as RequisitoDeImportacion[]
          )
            .slice(0, 200)
            .map((r) => ({
              nodeId: remapeo[String(r.nodeId)] ?? String(r.nodeId),
              campo: String(r.campo),
              tipo: String(r.tipo),
              nodo: String(r.nodo ?? ''),
            }))
        : [],
      checksum: checksumEsperado,
    },
    nodosDesconocidos,
    avisos,
    checksumCoincide,
    remapeo,
  };
}

// ── ayudas ─────────────────────────────────────────────────────

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A texto SOLO lo que tiene una representacion legible.
 *
 * `String(valor)` sobre un objeto produce "[object Object]", y esto lee un
 * archivo de fuera: un `type` que llegue como objeto acabaria siendo el tipo
 * de nodo literal «[object Object]». Es el mismo fallo que ya mordio en la
 * importacion de productos, donde esa cadena acabo siendo el NOMBRE de un
 * producto en el catalogo de un cliente.
 */
function textoSeguro(valor: unknown, porDefecto = ''): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  return porDefecto;
}

/**
 * Copia un objeto entrante DESCARTANDO las claves peligrosas.
 *
 * Un `__proto__` dentro de un JSON puede cambiar el comportamiento de todos
 * los objetos del proceso. `JSON.parse` no lo aplica solo, pero cualquier
 * copia posterior con spread o `Object.assign` sí lo haría.
 */
function limpiarObjeto(v: unknown, nivel = 0): Record<string, unknown> {
  if (nivel > MAX_PROFUNDIDAD_JSON || !esObjeto(v)) return {};
  const salida: Record<string, unknown> = Object.create(null);
  for (const [clave, valor] of Object.entries(v)) {
    if (CLAVES_PROHIBIDAS.has(clave)) continue;
    if (typeof valor === 'function') continue;
    if (esObjeto(valor)) {
      salida[clave] = limpiarObjeto(valor, nivel + 1);
    } else if (Array.isArray(valor)) {
      salida[clave] = valor
        .slice(0, 200)
        .map((x) => (esObjeto(x) ? limpiarObjeto(x, nivel + 1) : x));
    } else if (typeof valor === 'string') {
      salida[clave] = valor.slice(0, LIMITES.MAX_LONGITUD_TEXTO);
    } else {
      salida[clave] = valor;
    }
  }
  // Se devuelve un objeto plano y no el `null`-prototipo, para que Prisma y
  // JSON.stringify lo traten con normalidad.
  return { ...salida };
}

function profundidadDe(v: unknown, nivel = 1): number {
  if (!esObjeto(v) && !Array.isArray(v)) return nivel;
  if (nivel > MAX_PROFUNDIDAD_JSON + 1) return nivel;
  const hijos = Array.isArray(v) ? v : Object.values(v);
  let max = nivel;
  for (const hijo of hijos) {
    const d = profundidadDe(hijo, nivel + 1);
    if (d > max) max = d;
  }
  return max;
}

function nombreSeguro(m: unknown): string {
  if (esObjeto(m) && typeof m.nombre === 'string' && m.nombre.trim()) {
    return m.nombre.trim().slice(0, 120);
  }
  return 'Pulso importado';
}

function descripcionSegura(m: unknown): string | null {
  if (esObjeto(m) && typeof m.descripcion === 'string') {
    return m.descripcion.slice(0, 500);
  }
  return null;
}

function fechaSegura(m: unknown): string {
  if (esObjeto(m) && typeof m.exportadoEn === 'string') return m.exportadoEn;
  return '';
}
