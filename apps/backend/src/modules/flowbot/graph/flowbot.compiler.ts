import { createHash } from 'crypto';
import {
  CATALOGO,
  GrafoFlow,
  NodoFlow,
  TipoNodo,
  esTipoValido,
  puertosDe,
} from './flowbot.graph';
import {
  ProblemaGrafo,
  ReferenciasEmpresa,
  sePuedePublicar,
  validarGrafo,
} from './flowbot.validator';

/**
 * Compilador del grafo.
 *
 * POR QUÉ COMPILAR EN VEZ DE EJECUTAR EL GRAFO CRUDO: el motor da un paso cada
 * vez que llega un mensaje, y a veces días después del anterior. Buscar el
 * nodo actual recorriendo un array y resolver su salida filtrando conexiones
 * es trabajo repetido en cada paso, sobre una estructura que ya no puede
 * cambiar —la versión es inmutable—. Compilar una vez al publicar deja un
 * mapa directo `nodo → puerto → destino`.
 *
 * El compilado se guarda con su huella. Si dos versiones tienen la misma
 * huella son la misma definición, y una ejecución puede comprobar que la
 * versión que la arrancó es la que la sigue ejecutando.
 */

export interface NodoCompilado {
  id: string;
  type: TipoNodo;
  label?: string;
  config: Record<string, unknown>;
  /** Puerto → id del nodo destino. Ya resuelto. */
  salidas: Record<string, string>;
  /** El motor lo usa para decidir si debe crear una espera durable. */
  espera: boolean;
  efectoExterno: boolean;
  requiereIA: boolean;
}

export interface GrafoCompilado {
  schemaVersion: number;
  startNodeId: string;
  /** Indexado por id: el motor accede en O(1). */
  nodos: Record<string, NodoCompilado>;
  /** Tipo del disparador, para no tener que buscarlo. */
  triggerType: TipoNodo;
  /** Config del disparador, que es lo que filtra los eventos candidatos. */
  triggerConfig: Record<string, unknown>;
}

export interface ResultadoCompilacion {
  ok: boolean;
  problemas: ProblemaGrafo[];
  compilado?: GrafoCompilado;
  hash?: string;
}

/**
 * Valida y compila. Solo devuelve `compilado` si NO hay errores: publicar un
 * grafo inválido es exactamente lo que este paso existe para impedir.
 */
export function compilar(
  grafo: GrafoFlow,
  referencias?: ReferenciasEmpresa,
): ResultadoCompilacion {
  const problemas = validarGrafo(grafo, referencias);
  if (!sePuedePublicar(problemas)) return { ok: false, problemas };

  const nodos: Record<string, NodoCompilado> = {};
  const porId = new Map<string, NodoFlow>(grafo.nodes.map((n) => [n.id, n]));

  for (const nodo of grafo.nodes) {
    if (!esTipoValido(nodo.type)) continue;
    const def = CATALOGO[nodo.type];
    const salidas: Record<string, string> = {};

    for (const con of grafo.edges) {
      if (con.from !== nodo.id) continue;
      if (!porId.has(con.to)) continue;
      if (!puertosDe(nodo).includes(con.fromPort)) continue;
      salidas[con.fromPort] = con.to;
    }

    nodos[nodo.id] = {
      id: nodo.id,
      type: nodo.type,
      label: nodo.label,
      config: nodo.config ?? {},
      salidas,
      espera: def.esperaExterna,
      efectoExterno: def.efectoExterno,
      requiereIA: Boolean(def.requiereIA),
    };
  }

  const inicio = porId.get(grafo.startNodeId);
  // El validador ya garantiza que existe y es disparador; esto solo estrecha
  // el tipo sin volver a comprobar la regla.
  if (!inicio || !esTipoValido(inicio.type)) {
    return { ok: false, problemas };
  }

  const compilado: GrafoCompilado = {
    schemaVersion: grafo.schemaVersion,
    startNodeId: grafo.startNodeId,
    nodos,
    triggerType: inicio.type,
    triggerConfig: inicio.config ?? {},
  };

  return {
    ok: true,
    problemas,
    compilado,
    hash: huella(compilado),
  };
}

/**
 * Huella estable del compilado.
 *
 * Las claves se ordenan antes de serializar: sin eso, dos compilaciones del
 * mismo grafo darían huellas distintas solo porque el orden de inserción de un
 * objeto cambió, y la huella dejaría de servir para comparar.
 */
export function huella(compilado: GrafoCompilado): string {
  return createHash('sha256').update(estable(compilado)).digest('hex');
}

function estable(valor: unknown): string {
  if (valor === null || typeof valor !== 'object')
    return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(estable).join(',')}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${estable(v)}`).join(',')}}`;
}

/** Siguiente nodo por un puerto, o `null` si esa salida no lleva a ningún sitio. */
export function siguiente(
  compilado: GrafoCompilado,
  nodeId: string,
  puerto: string,
): NodoCompilado | null {
  const destino = compilado.nodos[nodeId]?.salidas?.[puerto];
  return destino ? (compilado.nodos[destino] ?? null) : null;
}

/** Grafo vacío para un bot recién creado: un disparador y nada más. */
export function grafoInicial(): GrafoFlow {
  return {
    schemaVersion: 1,
    startNodeId: 'inicio',
    nodes: [
      {
        id: 'inicio',
        type: 'trigger.inbound_message',
        position: { x: 240, y: 160 },
        config: {},
      },
    ],
    edges: [],
  };
}
