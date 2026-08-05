import type {
  ConexionFlow,
  GrafoFlow,
  NodoCatalogoDto,
  NodoFlow,
  Problema,
} from '@/lib/flowbots';
import type { EstadoNodo } from './NodoFlowBot';

/**
 * Traducción entre el grafo que guarda el servidor y lo que dibuja el lienzo.
 *
 * SE MANTIENE EL GRAFO DEL SERVIDOR COMO ÚNICA VERDAD. La alternativa —llevar
 * el estado en la forma de React Flow y convertir solo al guardar— parece más
 * cómoda hasta que hay que decidir qué pasa con un campo que la librería no
 * conoce: se pierde en silencio. Aquí la librería recibe una proyección y
 * nunca es la dueña de nada.
 */

/** Puertos reales de un nodo, incluidos los que salen de su configuración. */
export function puertosDe(
  nodo: NodoFlow,
  def: NodoCatalogoDto | null,
): Array<{ id: string; etiqueta: string }> {
  if (!def) return [{ id: 'next', etiqueta: 'Continuar' }];

  const fijos = def.puertos;
  if (!def.puertosDinamicos) return fijos;

  const clave = def.puertosDinamicos === 'opciones' ? 'options' : 'cases';
  const lista = nodo.config[clave];
  const cuantos = Array.isArray(lista) ? lista.length : 0;
  const prefijo = def.puertosDinamicos === 'opciones' ? 'opcion' : 'caso';

  return [
    ...Array.from({ length: cuantos }, (_, i) => ({
      id: `${prefijo}:${i}`,
      // La etiqueta es lo que escribió la persona, no «opcion:0»: en un menú
      // de cinco botones los índices no dicen nada.
      etiqueta:
        typeof (lista as unknown[])[i] === 'string' &&
        ((lista as string[])[i] ?? '').trim()
          ? (lista as string[])[i]
          : `Opción ${i + 1}`,
    })),
    ...fijos,
  ];
}

/**
 * Un puerto solo admite UNA conexión.
 *
 * Es la regla del motor: al recorrer el flujo elige una salida y sigue por
 * ella. Dos conexiones en el mismo puerto no significan «las dos», significan
 * que una se ignora, y cuál es imposible de saber mirando el dibujo.
 */
export function puertoOcupado(
  edges: ConexionFlow[],
  nodeId: string,
  port: string,
): ConexionFlow | undefined {
  return edges.find((e) => e.from === nodeId && e.fromPort === port);
}

/**
 * ¿Se puede conectar esto con esto?
 *
 * El servidor lo comprueba igual al validar; esto solo evita dibujar algo que
 * se sabe imposible, que es mejor que dejar hacerlo y explicarlo después.
 */
export function conexionValida(
  grafo: GrafoFlow,
  catalogo: Map<string, NodoCatalogoDto>,
  desde: { nodeId: string; port: string },
  hasta: { nodeId: string },
): { ok: boolean; motivo?: string } {
  if (desde.nodeId === hasta.nodeId) {
    return { ok: false, motivo: 'Un paso no se puede conectar consigo mismo.' };
  }

  const destino = grafo.nodes.find((n) => n.id === hasta.nodeId);
  const defDestino = destino ? catalogo.get(destino.type) : undefined;

  if (defDestino && !defDestino.aceptaEntrada) {
    return {
      ok: false,
      motivo: 'Un disparador solo puede estar al principio.',
    };
  }

  if (puertoOcupado(grafo.edges, desde.nodeId, desde.port)) {
    return {
      ok: false,
      motivo: 'Esa salida ya lleva a otro paso. Quita la conexión primero.',
    };
  }

  return { ok: true };
}

/** Estado visual de cada nodo a partir de los problemas del servidor. */
export function estadoDe(
  nodo: NodoFlow,
  def: NodoCatalogoDto | null,
  problemas: Problema[],
): EstadoNodo {
  if (!def || !def.disponible) return 'deshabilitado';

  const suyos = problemas.filter((p) => p.nodeId === nodo.id);
  if (suyos.some((p) => p.severidad === 'error')) {
    // Falta algo obligatorio vs. está mal puesto: la primera se arregla
    // rellenando, la segunda revisando. No es lo mismo y no se pinta igual.
    const faltaConfig = def.config.some(
      (c) => c.obligatorio && vacio(nodo.config[c.nombre]),
    );
    return faltaConfig ? 'incompleto' : 'invalido';
  }
  return 'normal';
}

function vacio(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Resumen de una línea para enseñar dentro del nodo. */
export function resumenDe(nodo: NodoFlow, def: NodoCatalogoDto | null): string {
  const c = nodo.config;

  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if (texto(c.text)) return recortar(texto(c.text));
  if (texto(c.question)) return recortar(texto(c.question));
  if (texto(c.templateName)) return `Plantilla: ${texto(c.templateName)}`;
  if (texto(c.url)) return `${texto(c.method) || 'GET'} ${recortar(texto(c.url), 40)}`;
  if (texto(c.prompt)) return recortar(texto(c.prompt));
  if (Array.isArray(c.options)) return `${c.options.length} opciones`;
  if (Array.isArray(c.keywords)) return (c.keywords as string[]).join(', ');
  if (typeof c.minutes === 'number') return `Espera ${c.minutes} min`;
  if (typeof c.hours === 'number') return `Espera ${c.hours} h`;
  if (typeof c.days === 'number') return `Espera ${c.days} días`;
  if (typeof c.percent === 'number') return `${c.percent}% por la rama sí`;

  return def?.ayuda ?? '';
}

function recortar(texto: string, maximo = 60): string {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/** Genera un identificador de nodo estable y legible. */
export function nuevoId(tipo: string, existentes: Set<string>): string {
  const base = tipo.split('.')[1] ?? tipo;
  let i = 1;
  let id = `${base}-${i}`;
  while (existentes.has(id)) {
    i += 1;
    id = `${base}-${i}`;
  }
  return id;
}

/** Configuración inicial de un paso recién añadido. */
export function configuracionInicial(
  def: NodoCatalogoDto,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const campo of def.config) {
    // Las listas arrancan con una entrada vacía porque un menú sin opciones
    // no tiene ni una salida y el nodo queda sin puertos que conectar.
    if (campo.tipo === 'lista' && campo.obligatorio) config[campo.nombre] = [''];
  }
  return config;
}

/** Quita conexiones que apuntan a puertos que ya no existen. */
export function limpiarConexiones(
  grafo: GrafoFlow,
  catalogo: Map<string, NodoCatalogoDto>,
): GrafoFlow {
  const validos = new Map<string, Set<string>>();
  for (const nodo of grafo.nodes) {
    validos.set(
      nodo.id,
      new Set(puertosDe(nodo, catalogo.get(nodo.type) ?? null).map((p) => p.id)),
    );
  }

  const ids = new Set(grafo.nodes.map((n) => n.id));
  const edges = grafo.edges.filter(
    (e) =>
      ids.has(e.from) &&
      ids.has(e.to) &&
      (validos.get(e.from)?.has(e.fromPort) ?? false),
  );

  return edges.length === grafo.edges.length ? grafo : { ...grafo, edges };
}
