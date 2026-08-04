import api from './axios';
import type { TonoBadge } from '@/components/ui/Badge';

/**
 * Acceso a la API de FlowBot.
 *
 * LOS TIPOS SON UN ESPEJO DEL CONTRATO DEL BACKEND, no una segunda definición
 * del producto. Nada de lo que hay aquí decide nada: el catálogo de nodos, qué
 * puertos tiene cada uno y si está disponible lo dice `GET /flowbots/catalog`.
 * Mantener una lista de nodos también aquí es como acaban divergiendo el
 * editor y el servidor hasta que uno deja dibujar lo que el otro rechaza.
 */

// ── catálogo ────────────────────────────────────────────────────

export interface PuertoDto {
  id: string;
  etiqueta: string;
}

export interface CampoConfigDto {
  nombre: string;
  tipo: string;
  obligatorio: boolean;
  referencia?: string;
}

export interface NodoCatalogoDto {
  tipo: string;
  categoria: string;
  etiqueta: string;
  ayuda: string;
  aceptaEntrada: boolean;
  puertos: PuertoDto[];
  /** Genera puertos desde su configuración: `opcion:0…` o `caso:0…`. */
  puertosDinamicos?: 'opciones' | 'casos';
  config: CampoConfigDto[];
  esperaExterna: boolean;
  efectoExterno: boolean;
  requiereIA: boolean;
  rolMinimo: string | null;
  disponible: boolean;
  motivoNoDisponible?: string;
}

/** Una variable insertable. La lista la manda el servidor, no el editor. */
export interface VariableDto {
  ruta: string;
  grupo: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'identificador';
  ejemplo: string;
  siempre: boolean;
  producidaPor?: string[];
}

export interface CatalogoDto {
  nodos: NodoCatalogoDto[];
  categorias: Array<{ id: string; etiqueta: string }>;
  limites: Record<string, number>;
  puertos: Record<string, string>;
  variables: VariableDto[];
}

// ── grafo ───────────────────────────────────────────────────────

export interface NodoFlow {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  label?: string;
}

export interface ConexionFlow {
  id: string;
  from: string;
  fromPort: string;
  to: string;
}

export interface GrafoFlow {
  schemaVersion: number;
  startNodeId: string;
  nodes: NodoFlow[];
  edges: ConexionFlow[];
}

// ── bots ────────────────────────────────────────────────────────

export interface BotResumen {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: string;
  esPlantilla: boolean;
  versionPublicada: number | null;
  publishedVersionId: string | null;
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

export interface BotDetalle extends BotResumen {
  draftGraph: GrafoFlow;
  versiones: VersionResumen[];
}

export interface VersionResumen {
  id: string;
  version: number;
  compiledHash: string;
  publishNote: string | null;
  publishedAt: string;
  publishedBy: string | null;
  esActual: boolean;
  ejecuciones: number;
}

export interface VersionDetalle extends VersionResumen {
  graph: GrafoFlow;
}

export interface ComparacionVersiones {
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

export interface Problema {
  codigo: string;
  severidad: 'error' | 'aviso';
  mensaje: string;
  nodeId?: string;
  edgeId?: string;
  campo?: string;
  solucion?: string;
}

export interface ResultadoValidacion {
  ok: boolean;
  sePuedePublicar: boolean;
  problemas: Problema[];
  compiledHash?: string;
}

// ── plantillas ──────────────────────────────────────────────────

export interface PlantillaResumen {
  clave: string;
  nombre: string;
  descripcion: string;
  objetivo: string;
  categoria: string;
  requiere: string[];
  camposPorCompletar: string[];
  nodos: number;
}

// ── disparadores ────────────────────────────────────────────────

export interface Disparador {
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

export interface EjecucionResumen {
  id: string;
  estado: string;
  botId: string;
  botNombre: string;
  versionId: string;
  version: number | null;
  correlationId: string;
  conversationId: string | null;
  contactId: string | null;
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

export interface PasoEjecucion {
  id: string;
  nodeId: string;
  nodeType: string;
  estado: string;
  puertoSalida: string | null;
  errorCode: string | null;
  duracionMs: number | null;
  intento: number;
  meta: unknown;
  en: string;
}

export interface EsperaEjecucion {
  id: string;
  tipo: string;
  resumeNodeId: string;
  timeoutPort: string | null;
  wakeAt: string | null;
  consumidaEn: string | null;
  eventKey: string | null;
}

export interface EjecucionDetalle extends EjecucionResumen {
  variables: Record<string, unknown>;
  pasos_detalle: PasoEjecucion[];
  esperas: EsperaEjecucion[];
  handoff: {
    id: string;
    estado: string;
    motivo: string | null;
    asignadoA: string | null;
    nodeId: string | null;
    iniciadoEn: string;
    resueltoEn: string | null;
  } | null;
  efectos: Array<{ nodeId: string; tipo: string; resultado: string }>;
}

export interface Pagina<T> {
  items: T[];
  siguienteCursor: string | null;
  total?: number;
}

// ── métricas ────────────────────────────────────────────────────

export interface Metricas {
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

export interface EntradaSimulacion {
  graph: GrafoFlow;
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
  ahora?: string;
  whatsappIntegrationId?: string;
  respuestas?: string[];
  fallos?: { whatsapp?: boolean; http?: boolean; ia?: boolean };
  respuestaIa?: { eleccion?: string; texto?: string; confianza?: number };
  respuestaHttp?: { estado?: number; datos?: unknown };
  avanzarRelojSegundos?: number;
  forzarTimeout?: boolean;
}

export interface ResultadoSimulacion {
  ok: boolean;
  estadoFinal: string;
  motivo?: string;
  ruta: string[];
  nodoActual: string | null;
  decisiones: Array<{
    nodeId: string;
    nodeType: string;
    puerto: string | null;
    explicacion: string;
  }>;
  variablesAntes: Record<string, unknown>;
  variablesDespues: Record<string, unknown>;
  efectos: Array<{
    puerto: string;
    operacion: string;
    datos: Record<string, unknown>;
  }>;
  mensajes: Array<{ tipo: string; texto: string }>;
  esperas: Array<{ kind: string; wakeAt: string | null; nodeId: string }>;
  handoff: { motivo: string } | null;
  errores: Problema[];
  advertencias: Problema[];
  pasos: number;
  turnos: number;
}

/**
 * Conflicto al guardar el borrador.
 *
 * Se modela aparte porque NO es un error cualquiera: trae el estado remoto
 * para que la interfaz pueda enseñar las dos versiones en vez de obligar a
 * recargar perdiendo el trabajo.
 */
export interface ConflictoBorrador {
  codigo: 'borrador.conflicto';
  mensaje: string;
  revisionEnviada: number;
  revisionActual: number;
  actualizadoPor: string | null;
  actualizadoEn: string;
  graphActual: GrafoFlow;
}

export function esConflictoDeBorrador(
  error: unknown,
): ConflictoBorrador | null {
  const respuesta = (
    error as { response?: { status?: number; data?: unknown } } | undefined
  )?.response;
  if (respuesta?.status !== 409) return null;

  // El cuerpo puede venir envuelto en `message` según cómo Nest serialice la
  // excepción; se aceptan las dos formas en vez de confiar en una.
  const datos = respuesta.data as Record<string, unknown> | undefined;
  const cuerpo = (datos?.message ?? datos) as ConflictoBorrador | undefined;
  return cuerpo?.codigo === 'borrador.conflicto' ? cuerpo : null;
}

// ── llamadas ────────────────────────────────────────────────────

export const flowbots = {
  catalogo: () => api.get<CatalogoDto>('/flowbots/catalog').then((r) => r.data),

  plantillas: () =>
    api.get<PlantillaResumen[]>('/flowbots/templates').then((r) => r.data),

  usarPlantilla: (clave: string, nombre?: string) =>
    api
      .post<{ id: string; camposPorCompletar: string[] }>(
        `/flowbots/templates/${clave}/use`,
        { nombre },
      )
      .then((r) => r.data),

  listar: (filtros: {
    q?: string;
    estado?: string;
    incluirArchivados?: boolean;
  } = {}) =>
    api
      .get<BotResumen[]>('/flowbots', {
        params: {
          ...(filtros.q ? { q: filtros.q } : {}),
          ...(filtros.estado ? { estado: filtros.estado } : {}),
          ...(filtros.incluirArchivados ? { incluirArchivados: 'true' } : {}),
        },
      })
      .then((r) => r.data),

  detalle: (id: string) =>
    api.get<BotDetalle>(`/flowbots/${id}`).then((r) => r.data),

  crear: (datos: { nombre: string; descripcion?: string; graph?: GrafoFlow }) =>
    api.post<{ id: string }>('/flowbots', datos).then((r) => r.data),

  duplicar: (id: string) =>
    api.post<{ id: string }>(`/flowbots/${id}/duplicate`).then((r) => r.data),

  renombrar: (id: string, nombre: string, descripcion?: string) =>
    api.patch(`/flowbots/${id}`, { nombre, descripcion }).then((r) => r.data),

  cambiarEstado: (id: string, estado: string) =>
    api.post(`/flowbots/${id}/status`, { estado }).then((r) => r.data),

  eliminar: (id: string) => api.delete(`/flowbots/${id}`).then((r) => r.data),

  borrador: (id: string) =>
    api
      .get<{
        botId: string;
        graph: GrafoFlow;
        revision: number;
        actualizadoEn: string;
        actualizadoPor: string | null;
      }>(`/flowbots/${id}/draft`)
      .then((r) => r.data),

  guardarBorrador: (id: string, graph: GrafoFlow, revision: number) =>
    api
      .post<{ guardado: boolean; revision: number; actualizadoEn: string }>(
        `/flowbots/${id}/draft`,
        { graph, revision },
      )
      .then((r) => r.data),

  /**
   * Valida un grafo. Acepta `signal` para poder CANCELAR una validación que ya
   * no interesa: sin eso, escribir rápido deja varias en vuelo y la última en
   * responder no tiene por qué ser la del grafo actual.
   */
  validar: (graph: GrafoFlow, signal?: AbortSignal) =>
    api
      .post<ResultadoValidacion>('/flowbots/validate', { graph }, { signal })
      .then((r) => r.data),

  publicar: (id: string, nota?: string) =>
    api
      .post<{ versionId: string; version: number; compiledHash: string }>(
        `/flowbots/${id}/publish`,
        { nota },
      )
      .then((r) => r.data),

  versiones: (id: string) =>
    api.get<VersionResumen[]>(`/flowbots/${id}/versions`).then((r) => r.data),

  version: (id: string, versionId: string) =>
    api
      .get<VersionDetalle>(`/flowbots/${id}/versions/${versionId}`)
      .then((r) => r.data),

  comparar: (id: string, desde: string, hasta: string) =>
    api
      .get<ComparacionVersiones>(
        `/flowbots/${id}/versions/${desde}/diff/${hasta}`,
      )
      .then((r) => r.data),

  restaurarVersion: (id: string, versionId: string) =>
    api
      .post<{ restaurada: number; revision: number }>(
        `/flowbots/${id}/versions/${versionId}/restore`,
      )
      .then((r) => r.data),

  disparadores: (id: string) =>
    api.get<Disparador[]>(`/flowbots/${id}/triggers`).then((r) => r.data),

  crearDisparador: (id: string, datos: Record<string, unknown>) =>
    api.post<Disparador>(`/flowbots/${id}/triggers`, datos).then((r) => r.data),

  actualizarDisparador: (
    id: string,
    triggerId: string,
    datos: Record<string, unknown>,
  ) =>
    api
      .patch<Disparador>(`/flowbots/${id}/triggers/${triggerId}`, datos)
      .then((r) => r.data),

  eliminarDisparador: (id: string, triggerId: string) =>
    api.delete(`/flowbots/${id}/triggers/${triggerId}`).then((r) => r.data),

  simular: (entrada: EntradaSimulacion) =>
    api
      .post<ResultadoSimulacion>('/flowbots/simulate', entrada)
      .then((r) => r.data),

  ejecuciones: (
    filtros: Record<string, string | undefined> = {},
    paginacion: { cursor?: string; limite?: number } = {},
  ) =>
    api
      .get<Pagina<EjecucionResumen>>('/flowbots/executions/list', {
        params: {
          ...Object.fromEntries(
            Object.entries(filtros).filter(([, v]) => v),
          ),
          ...(paginacion.cursor ? { cursor: paginacion.cursor } : {}),
          ...(paginacion.limite ? { limite: String(paginacion.limite) } : {}),
        },
      })
      .then((r) => r.data),

  ejecucion: (executionId: string) =>
    api
      .get<EjecucionDetalle>(`/flowbots/executions/${executionId}`)
      .then((r) => r.data),

  cancelarEjecucion: (executionId: string, motivo: string) =>
    api
      .post(`/flowbots/executions/${executionId}/cancel`, { motivo })
      .then((r) => r.data),

  pausarEjecucion: (executionId: string) =>
    api.post(`/flowbots/executions/${executionId}/pause`).then((r) => r.data),

  reanudarEjecucion: (executionId: string) =>
    api.post(`/flowbots/executions/${executionId}/resume`).then((r) => r.data),

  reintentarEjecucion: (executionId: string) =>
    api
      .post<{ reintentada: boolean; estado: string; motivo?: string }>(
        `/flowbots/executions/${executionId}/retry`,
      )
      .then((r) => r.data),

  forzarHandoff: (
    executionId: string,
    datos: { asignarA?: string; motivo?: string; nota?: string },
  ) =>
    api
      .post(`/flowbots/executions/${executionId}/handoff`, datos)
      .then((r) => r.data),

  metricas: (filtros: { desde?: string; hasta?: string; botId?: string } = {}) =>
    api
      .get<Metricas>('/flowbots/metrics/summary', { params: filtros })
      .then((r) => r.data),
};

// ── estados, para pintarlos igual en todas partes ───────────────

/**
 * Cómo se llama y de qué color va cada estado.
 *
 * Vive AQUÍ y no repartido por las pantallas: el listado, el detalle y el
 * historial tienen que decir lo mismo del mismo estado, y con tres copias la
 * tercera acaba diciendo otra cosa.
 */
export const ESTADO_BOT: Record<
  string,
  { etiqueta: string; tono: TonoBadge }
> = {
  DRAFT: { etiqueta: 'Borrador', tono: 'neutral' },
  ACTIVE: { etiqueta: 'Activo', tono: 'success' },
  PAUSED: { etiqueta: 'Pausado', tono: 'warning' },
  ARCHIVED: { etiqueta: 'Archivado', tono: 'neutral' },
};

export const ESTADO_EJECUCION: Record<
  string,
  { etiqueta: string; tono: TonoBadge }
> = {
  RUNNING: { etiqueta: 'En curso', tono: 'success' },
  WAITING_INPUT: { etiqueta: 'Esperando respuesta', tono: 'warning' },
  WAITING_TIME: { etiqueta: 'Esperando tiempo', tono: 'warning' },
  COMPLETED: { etiqueta: 'Terminada', tono: 'neutral' },
  FAILED: { etiqueta: 'Con error', tono: 'error' },
  CANCELLED: { etiqueta: 'Cancelada', tono: 'neutral' },
  HANDED_OFF: { etiqueta: 'Con una persona', tono: 'warning' },
  PAUSED: { etiqueta: 'Pausada', tono: 'warning' },
  NEEDS_ATTENTION: { etiqueta: 'Necesita revisión', tono: 'error' },
};
