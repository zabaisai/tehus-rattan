import {
  CATALOGO,
  CategoriaNodo,
  DefinicionNodo,
  LIMITES,
  TipoNodo,
} from '../graph/flowbot.graph';
import { ejecutorDe } from '../engine/flowbot.executors';
import { VARIABLES_SISTEMA } from '../graph/flowbot.variables';
import { ProblemaGrafo } from '../graph/flowbot.validator';

/**
 * Contrato entre el backend y el futuro constructor visual.
 *
 * UN SOLO CATÁLOGO. El editor NO mantiene su propia lista de nodos: la pide.
 * Dos catálogos escritos a mano divergen el día que alguien añade un puerto
 * en uno y se olvida del otro, y entonces el editor deja dibujar una conexión
 * que el servidor rechaza al publicar — o peor, deja de ofrecer un nodo que sí
 * funciona.
 *
 * `DISPONIBLE` LO DECIDE EL SERVIDOR, no el editor. Un tipo que está en el
 * catálogo pero no tiene ejecutor no puede mostrarse como listo: se marca, y
 * el validador rechaza publicarlo. Así el catálogo puede crecer con nodos
 * planificados sin que nadie los use antes de tiempo.
 */

// ── catálogo ────────────────────────────────────────────────────

export interface PuertoDto {
  /** Identificador estable: `next`, `true`, `false`, `timeout`, `error`… */
  id: string;
  /** Etiqueta para la interfaz, ya en español. */
  etiqueta: string;
}

export interface CampoConfigDto {
  nombre: string;
  tipo: string;
  obligatorio: boolean;
  /** Qué referencia del CRM espera: `pipeline`, `stage`, `user`… */
  referencia?: string;
}

export interface NodoCatalogoDto {
  tipo: TipoNodo;
  categoria: CategoriaNodo;
  etiqueta: string;
  ayuda: string;
  aceptaEntrada: boolean;
  puertos: PuertoDto[];
  /**
   * Si genera puertos a partir de su configuración: un menú de tres opciones
   * tiene `opcion:0..2` además de los fijos.
   *
   * El editor lo NECESITA para dibujar las salidas. Sin esto tendría que
   * saberse de memoria que `send.buttons` no sale por `next`, y esa es
   * exactamente la clase de cosa que se olvida y deja conectar una rama que
   * el motor nunca recorre.
   */
  puertosDinamicos?: 'opciones' | 'casos';
  config: CampoConfigDto[];
  esperaExterna: boolean;
  efectoExterno: boolean;
  requiereIA: boolean;
  rolMinimo: string | null;
  /**
   * `false` cuando el tipo NO tiene ejecutor todavía.
   *
   * El editor debe ocultarlo o marcarlo como no disponible, y el servidor
   * rechaza publicarlo igualmente: un nodo que se puede dibujar pero no se
   * puede ejecutar es una promesa rota a mitad de una conversación.
   */
  disponible: boolean;
  /** Por qué no está disponible, cuando no lo está. */
  motivoNoDisponible?: string;
}

/**
 * Una variable que se puede insertar en un texto.
 *
 * VA EN EL CATÁLOGO Y NO EN EL EDITOR por el mismo motivo que los nodos: la
 * lista de variables del motor es CERRADA —es lo que permite al validador
 * decir «esa variable no existe» antes de publicar en vez de mandarle la
 * palabra `undefined` a un cliente—, así que una segunda lista escrita a mano
 * en el frontend solo puede quedarse corta o inventar variables que el
 * validador va a rechazar.
 */
export interface VariableDto {
  /** La ruta tal cual se escribe dentro de `{{ }}`. */
  ruta: string;
  grupo: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'identificador';
  /** Un valor de ejemplo, claramente falso, para entender qué sale ahí. */
  ejemplo: string;
  /**
   * `true` si el motor la pone siempre; `false` si depende de que antes se
   * haya ejecutado el paso que la produce.
   */
  siempre: boolean;
  /** Tipos de paso que la producen, cuando no está siempre. */
  producidaPor?: string[];
}

export interface CatalogoDto {
  nodos: NodoCatalogoDto[];
  categorias: Array<{ id: CategoriaNodo; etiqueta: string }>;
  limites: typeof LIMITES;
  puertos: Record<string, string>;
  variables: VariableDto[];
}

const ETIQUETAS_PUERTO: Record<string, string> = {
  next: 'Continuar',
  true: 'Sí',
  false: 'No',
  timeout: 'Sin respuesta',
  error: 'Si falla',
  fallback: 'Alternativa',
  human: 'A una persona',
};

const ETIQUETAS_CATEGORIA: Record<string, string> = {
  trigger: 'Inicio y disparadores',
  message: 'Mensajería',
  control: 'Esperas y condiciones',
  crm: 'Acciones CRM',
  integration: 'Integraciones',
  ai: 'Inteligencia artificial',
  conversation: 'Conversación',
};

/**
 * ¿Tiene este tipo un ejecutor de verdad?
 *
 * Se pregunta con una configuración vacía porque `ejecutorDe` la usa solo para
 * elegir variante —el rango de `ask.number`, por ejemplo—, nunca para decidir
 * si existe.
 */
export function tieneEjecutor(tipo: TipoNodo): boolean {
  try {
    return ejecutorDe(tipo, {}) !== null;
  } catch {
    return false;
  }
}

export function construirCatalogo(): CatalogoDto {
  const nodos: NodoCatalogoDto[] = Object.values(CATALOGO).map(
    (def: DefinicionNodo) => {
      const disponible = tieneEjecutor(def.tipo);
      return {
        tipo: def.tipo,
        categoria: def.categoria,
        etiqueta: def.etiqueta,
        ayuda: def.ayuda,
        aceptaEntrada: def.aceptaEntrada,
        puertos: def.puertos.map((p) => ({
          id: p,
          etiqueta: ETIQUETAS_PUERTO[p] ?? p,
        })),
        ...(def.puertosDinamicos
          ? { puertosDinamicos: def.puertosDinamicos }
          : {}),
        config: (def.config ?? []).map((c) => ({
          nombre: c.nombre,
          tipo: c.tipo,
          obligatorio: c.obligatorio !== false,
          referencia: c.referencia,
        })),
        esperaExterna: def.esperaExterna,
        efectoExterno: def.efectoExterno,
        requiereIA: Boolean(def.requiereIA),
        rolMinimo: def.rolMinimo ?? null,
        disponible,
        ...(disponible
          ? {}
          : {
              motivoNoDisponible:
                'Este paso todavía no se puede ejecutar. Está declarado pero sin implementación.',
            }),
      };
    },
  );

  const categorias = [...new Set(nodos.map((n) => n.categoria))].map((id) => ({
    id,
    etiqueta: ETIQUETAS_CATEGORIA[id] ?? id,
  }));

  return {
    nodos,
    categorias,
    limites: LIMITES,
    puertos: ETIQUETAS_PUERTO,
    variables: construirVariables(),
  };
}

/**
 * Descripción legible de cada variable.
 *
 * Solo METADATOS: la lista de qué variables existen sigue siendo
 * `VARIABLES_SISTEMA` más lo que declare cada nodo en `produce`. Este mapa no
 * puede añadir ninguna —lo que no esté en el motor no llega al editor— y una
 * prueba comprueba que no falta ninguna, para que añadir una variable sin
 * describirla se note al momento y no cuando alguien la vea en pantalla como
 * `lead.value` a secas.
 */
const DESCRIPCIONES: Record<
  string,
  {
    grupo: string;
    etiqueta: string;
    tipo: VariableDto['tipo'];
    ejemplo: string;
  }
> = {
  'contact.name': {
    grupo: 'Contacto',
    etiqueta: 'Nombre del contacto',
    tipo: 'texto',
    ejemplo: 'Ana Pérez',
  },
  'contact.phone': {
    grupo: 'Contacto',
    etiqueta: 'Teléfono',
    tipo: 'texto',
    ejemplo: '+57 300 000 0000',
  },
  'contact.email': {
    grupo: 'Contacto',
    etiqueta: 'Correo',
    tipo: 'texto',
    ejemplo: 'ana@ejemplo.com',
  },
  'contact.id': {
    grupo: 'Contacto',
    etiqueta: 'Identificador del contacto',
    tipo: 'identificador',
    ejemplo: 'cnt_ejemplo',
  },
  'company.name': {
    grupo: 'Empresa',
    etiqueta: 'Nombre de tu empresa',
    tipo: 'texto',
    ejemplo: 'Tu empresa',
  },
  'conversation.id': {
    grupo: 'Conversación',
    etiqueta: 'Identificador de la conversación',
    tipo: 'identificador',
    ejemplo: 'cnv_ejemplo',
  },
  'conversation.status': {
    grupo: 'Conversación',
    etiqueta: 'Estado de la conversación',
    tipo: 'texto',
    ejemplo: 'abierta',
  },
  'lead.id': {
    grupo: 'Oportunidad',
    etiqueta: 'Identificador de la oportunidad',
    tipo: 'identificador',
    ejemplo: 'opp_ejemplo',
  },
  'lead.title': {
    grupo: 'Oportunidad',
    etiqueta: 'Título de la oportunidad',
    tipo: 'texto',
    ejemplo: 'Cotización de ejemplo',
  },
  'lead.value': {
    grupo: 'Oportunidad',
    etiqueta: 'Valor',
    tipo: 'numero',
    ejemplo: '1500000',
  },
  'lead.stage': {
    grupo: 'Oportunidad',
    etiqueta: 'Etapa actual',
    tipo: 'texto',
    ejemplo: 'Nuevo lead',
  },
  'agent.id': {
    grupo: 'Responsable',
    etiqueta: 'Identificador del responsable',
    tipo: 'identificador',
    ejemplo: 'usr_ejemplo',
  },
  'agent.name': {
    grupo: 'Responsable',
    etiqueta: 'Nombre del responsable',
    tipo: 'texto',
    ejemplo: 'Camilo Ruiz',
  },
  'message.text': {
    grupo: 'Mensaje',
    etiqueta: 'Lo último que escribió el cliente',
    tipo: 'texto',
    ejemplo: 'Hola, quiero información',
  },
  'message.choice': {
    grupo: 'Mensaje',
    etiqueta: 'Opción que eligió',
    tipo: 'texto',
    ejemplo: 'Ver precios',
  },
  'task.id': {
    grupo: 'Ejecución',
    etiqueta: 'Identificador de la tarea creada',
    tipo: 'identificador',
    ejemplo: 'tsk_ejemplo',
  },
  'suggestion.id': {
    grupo: 'Ejecución',
    etiqueta: 'Identificador de la tarea propuesta',
    tipo: 'identificador',
    ejemplo: 'sug_ejemplo',
  },
  'ai.intent': {
    grupo: 'IA',
    etiqueta: 'Intención detectada',
    tipo: 'texto',
    ejemplo: 'precio',
  },
  'ai.confidence': {
    grupo: 'IA',
    etiqueta: 'Confianza de la IA',
    tipo: 'numero',
    ejemplo: '0.82',
  },
  'ai.reply': {
    grupo: 'IA',
    etiqueta: 'Respuesta redactada por la IA',
    tipo: 'texto',
    ejemplo: 'Con gusto te cuento…',
  },
  'ai.summary': {
    grupo: 'IA',
    etiqueta: 'Resumen de la conversación',
    tipo: 'texto',
    ejemplo: 'El cliente pregunta por precios',
  },
  'now.date': {
    grupo: 'Fecha y hora',
    etiqueta: 'Fecha de hoy',
    tipo: 'fecha',
    ejemplo: '2026-08-04',
  },
  'now.time': {
    grupo: 'Fecha y hora',
    etiqueta: 'Hora actual',
    tipo: 'fecha',
    ejemplo: '14:35',
  },
};

export function construirVariables(): VariableDto[] {
  const siempre = new Set<string>(VARIABLES_SISTEMA);

  // Qué paso produce cada variable, leído del propio catálogo. Sirve para
  // avisar de que `ai.intent` no vale de nada si antes no hay un paso de IA.
  const productores = new Map<string, string[]>();
  for (const def of Object.values(CATALOGO)) {
    for (const ruta of def.produce ?? []) {
      productores.set(ruta, [...(productores.get(ruta) ?? []), def.tipo]);
    }
  }

  const rutas = [...new Set([...siempre, ...productores.keys()])].sort();

  return rutas.map((ruta) => {
    const d = DESCRIPCIONES[ruta] ?? {
      grupo: 'Otras',
      etiqueta: ruta,
      tipo: 'texto' as const,
      ejemplo: 'valor de ejemplo',
    };
    const produce = productores.get(ruta);
    return {
      ruta,
      grupo: d.grupo,
      etiqueta: d.etiqueta,
      tipo: d.tipo,
      ejemplo: d.ejemplo,
      // «Siempre» significa que el motor la pone al arrancar. Que además la
      // produzca un paso no la quita de ahí.
      siempre: siempre.has(ruta),
      ...(produce && !siempre.has(ruta) ? { producidaPor: produce } : {}),
    };
  });
}

// ── bots ────────────────────────────────────────────────────────

export interface BotResumenDto {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: string;
  esPlantilla: boolean;
  /** Número de la versión publicada, o `null` si nunca se publicó. */
  versionPublicada: number | null;
  publishedVersionId: string | null;
  /** Revisión del borrador. El cliente la devuelve al guardar. */
  draftRevision: number;
  disparadores: Array<{
    id: string;
    tipo: string;
    activo: boolean;
    prioridad: number;
    exclusivo: boolean;
  }>;
  metricas: {
    ejecucionesTotales: number;
    ultimaEjecucionEn: string | null;
    tasaFinalizacion: number | null;
    handoffs: number;
    errores: number;
    necesitanAtencion: number;
  };
  creadoEn: string;
  actualizadoEn: string;
  actualizadoPor: string | null;
}

export interface BotDetalleDto extends BotResumenDto {
  /** El BORRADOR, no la versión publicada. Es lo que se edita. */
  draftGraph: unknown;
  versiones: VersionResumenDto[];
}

export interface VersionResumenDto {
  id: string;
  version: number;
  compiledHash: string;
  publishNote: string | null;
  publishedAt: string;
  publishedBy: string | null;
  /** `true` si es la que está corriendo ahora mismo. */
  esActual: boolean;
  ejecuciones: number;
}

export interface VersionDetalleDto extends VersionResumenDto {
  graph: unknown;
}

/**
 * Diferencia entre dos versiones.
 *
 * SE COMPARA POR NODO Y CONEXIÓN, no por texto. Un diff de JSON crudo marca
 * como cambio el reordenamiento de una clave y no dice nada útil a quien
 * quiere saber qué pasos cambiaron.
 */
export interface ComparacionVersionesDto {
  desde: { id: string; version: number };
  hasta: { id: string; version: number };
  nodos: {
    agregados: string[];
    eliminados: string[];
    modificados: Array<{ id: string; campos: string[] }>;
  };
  conexiones: { agregadas: string[]; eliminadas: string[] };
  identicos: boolean;
}

// ── validación ──────────────────────────────────────────────────

/**
 * Problema estructurado.
 *
 * EL FRONTEND NUNCA LEE EL MENSAJE PARA DECIDIR. El `codigo` es estable y el
 * `nodeId` permite enfocar el nodo; el mensaje es para la persona. Si el
 * editor ramificara sobre el texto, cualquier corrección de una errata
 * rompería la interfaz.
 */
export interface ProblemaDto {
  codigo: string;
  severidad: 'error' | 'aviso';
  mensaje: string;
  nodeId?: string;
  edgeId?: string;
  campo?: string;
  /** Qué hacer, en una frase. Vacío cuando no hay una acción obvia. */
  solucion?: string;
}

export interface ResultadoValidacionDto {
  ok: boolean;
  sePuedePublicar: boolean;
  problemas: ProblemaDto[];
  /** Huella del grafo compilado. Cambia si cambia algo que importa. */
  compiledHash?: string;
}

/** Sugerencias por código. El servidor las conoce; el editor solo las muestra. */
const SOLUCIONES: Record<string, string> = {
  'nodo.tipo_desconocido': 'Sustituye el paso por uno del catálogo actual.',
  'nodo.ia_sin_proveedor': 'Configura la IA en Ajustes o quita el paso.',
  'nodo.http_sin_configurar':
    'Activa las integraciones y declara los destinos permitidos en Ajustes.',
  'nodo.sin_salida': 'Conecta la salida de este paso a otro.',
  'conexion.destino_inexistente':
    'Vuelve a conectar la rama a un paso que exista.',
  'conexion.origen_inexistente': 'Elimina la conexión huérfana.',
  'conexion.puerto_inexistente':
    'Ese paso no tiene esa salida. Conéctala a una de las que sí tiene.',
  'grafo.sin_inicio': 'Añade un paso de inicio y conéctalo al resto.',
  'grafo.ciclo_sin_espera':
    'Un bucle necesita una espera dentro, o girará hasta agotar el tope de pasos.',
  'http.no_https': 'Cambia la dirección a https.',
  'http.credenciales_en_url': 'Usa una credencial guardada en vez de la URL.',
  'referencia.no_encontrada':
    'Ese recurso no existe o es de otra empresa. Elige uno de la lista.',
};

export function aProblemaDto(p: ProblemaGrafo): ProblemaDto {
  return {
    codigo: p.codigo,
    severidad: p.severidad,
    mensaje: p.mensaje,
    ...(p.nodeId ? { nodeId: p.nodeId } : {}),
    ...(p.edgeId ? { edgeId: p.edgeId } : {}),
    ...(SOLUCIONES[p.codigo] ? { solucion: SOLUCIONES[p.codigo] } : {}),
  };
}

// ── disparadores ────────────────────────────────────────────────

export interface DisparadorDto {
  id: string;
  tipo: string;
  activo: boolean;
  prioridad: number;
  exclusivo: boolean;
  filtros: unknown;
  whatsappIntegrationId: string | null;
  scheduleSpec: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

// ── ejecuciones ─────────────────────────────────────────────────

export interface EjecucionResumenDto {
  id: string;
  estado: string;
  botId: string;
  botNombre: string;
  versionId: string;
  version: number | null;
  correlationId: string;
  conversationId: string | null;
  contactId: string | null;
  /** Ya enmascarado. Nunca el número completo. */
  contacto: string | null;
  leadId: string | null;
  asignadoA: string | null;
  whatsappIntegrationId: string | null;
  pasos: number;
  errorCode: string | null;
  motivoFin: string | null;
  necesitaAtencion: boolean;
  hayHandoff: boolean;
  iniciadaEn: string;
  terminadaEn: string | null;
  duracionMs: number | null;
}

export interface PasoDto {
  id: string;
  nodeId: string;
  nodeType: string;
  estado: string;
  puertoSalida: string | null;
  errorCode: string | null;
  duracionMs: number | null;
  intento: number;
  /** Metadatos del paso, ya redactados. */
  meta: unknown;
  en: string;
}

export interface EsperaDto {
  id: string;
  tipo: string;
  resumeNodeId: string;
  timeoutPort: string | null;
  wakeAt: string | null;
  consumidaEn: string | null;
  eventKey: string | null;
}

export interface EjecucionDetalleDto extends EjecucionResumenDto {
  variables: Record<string, unknown>;
  pasos_detalle: PasoDto[];
  esperas: EsperaDto[];
  handoff: {
    id: string;
    estado: string;
    motivo: string | null;
    asignadoA: string | null;
    nodeId: string | null;
    iniciadoEn: string;
    resueltoEn: string | null;
  } | null;
  /** Efectos deducidos de los pasos: qué habría hecho el bot. */
  efectos: Array<{ nodeId: string; tipo: string; resultado: string }>;
}

/** Página estable por cursor. */
export interface PaginaDto<T> {
  items: T[];
  /** Cursor opaco para la siguiente página. `null` si no hay más. */
  siguienteCursor: string | null;
  /** Cuántos hay en total, solo cuando se pide explícitamente. */
  total?: number;
}

// ── métricas ────────────────────────────────────────────────────

export interface MetricasDto {
  desde: string;
  hasta: string;
  totales: {
    iniciadas: number;
    completadas: number;
    fallidas: number;
    canceladas: number;
    enEspera: number;
    entregadas: number;
    necesitanAtencion: number;
  };
  tasaFinalizacion: number | null;
  tasaHandoff: number | null;
  duracionMediaMs: number | null;
  reintentos: number;
  mensajesSimulados: number;
  porDia: Array<{ dia: string; iniciadas: number; completadas: number }>;
  nodosConMasErrores: Array<{ nodeType: string; errores: number }>;
  botsConMasErrores: Array<{ botId: string; nombre: string; errores: number }>;
}

// ── simulador ───────────────────────────────────────────────────

export interface EntradaSimulacionDto {
  /** El grafo a simular. Puede ser un borrador sin guardar. */
  graph: unknown;
  contacto?: {
    nombre?: string;
    telefono?: string;
    email?: string;
    etiquetas?: string[];
    campos?: Record<string, string>;
  };
  oportunidad?: { pipelineId?: string; stageId?: string; valor?: number };
  mensajeInicial?: string;
  variables?: Record<string, unknown>;
  zonaHoraria?: string;
  /** Instante desde el que arranca el reloj simulado, en ISO. */
  ahora?: string;
  whatsappIntegrationId?: string;
  /** Respuestas a las esperas, en orden. */
  respuestas?: string[];
  /** Fallos que se quieren provocar. */
  fallos?: {
    whatsapp?: boolean;
    http?: boolean;
    ia?: boolean;
  };
  /** Respuesta fija de la IA, para probar cada rama. */
  respuestaIa?: { eleccion?: string; texto?: string; confianza?: number };
  /** Respuesta fija del HTTP. */
  respuestaHttp?: { estado?: number; datos?: unknown };
  /** Cuánto adelantar el reloj entre pasos, en segundos. */
  avanzarRelojSegundos?: number;
  /** Forzar que las esperas venzan en vez de responderlas. */
  forzarTimeout?: boolean;
}

export interface ResultadoSimulacionDto {
  ok: boolean;
  estadoFinal: string;
  motivo?: string;
  /** Los nodos por los que pasó, en orden. */
  ruta: string[];
  nodoActual: string | null;
  /** Qué puerto se tomó en cada paso y por qué. */
  decisiones: Array<{
    nodeId: string;
    nodeType: string;
    puerto: string | null;
    explicacion: string;
  }>;
  variablesAntes: Record<string, unknown>;
  variablesDespues: Record<string, unknown>;
  /** Lo que HABRÍA hecho. Ninguno ocurrió. */
  efectos: Array<{
    puerto: string;
    operacion: string;
    datos: Record<string, unknown>;
  }>;
  mensajes: Array<{ tipo: string; texto: string }>;
  esperas: Array<{ kind: string; wakeAt: string | null; nodeId: string }>;
  handoff: { motivo: string } | null;
  errores: ProblemaDto[];
  advertencias: ProblemaDto[];
  pasos: number;
  /** Cuántas veces se reanudó con una respuesta. */
  turnos: number;
}
