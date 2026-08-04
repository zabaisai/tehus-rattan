import { NodoCompilado } from '../graph/flowbot.compiler';
import { ContextoVariables } from '../graph/flowbot.variables';

/**
 * Puertos de efecto del motor.
 *
 * EL MOTOR NO TOCA NADA DIRECTAMENTE. Todo lo que sale de él —mandar un
 * WhatsApp, crear una oportunidad, llamar a una API— pasa por una de estas
 * interfaces. Es lo que permite que el simulador sea de verdad inocuo: se le
 * pasan implementaciones que registran la intención en vez de ejecutarla, y no
 * hay ninguna vía por la que un efecto real se cuele.
 *
 * Sin esta separación, «modo simulación» sería una bandera repartida por
 * veinte sitios, y bastaría olvidarla en uno para mandar un mensaje a un
 * cliente real desde una prueba.
 */

/** Cómo terminó un nodo. */
export type ResultadoTipo =
  | 'continuar'
  | 'esperar'
  | 'terminar'
  | 'cancelar'
  | 'handoff'
  | 'error';

/** Clasificación de errores. Decide si se reintenta y con qué cara. */
export type ClaseError =
  | 'validacion'
  | 'configuracion'
  | 'autorizacion'
  | 'no_encontrado'
  | 'conflicto'
  | 'externo_reintentable'
  | 'externo_definitivo'
  | 'timeout'
  | 'rate_limit'
  | 'interno'
  | 'cancelado'
  | 'requiere_intervencion';

/** Qué errores merecen otro intento. Los demás solo gastarían tiempo. */
export const REINTENTABLES: ReadonlySet<ClaseError> = new Set<ClaseError>([
  'externo_reintentable',
  'timeout',
  'rate_limit',
  'interno',
]);

export function esReintentable(clase: ClaseError): boolean {
  return REINTENTABLES.has(clase);
}

export interface EsperaSolicitada {
  kind: 'INPUT' | 'TIME' | 'EVENT';
  /** Cuándo despertar. Para INPUT es el vencimiento, si lo hay. */
  wakeAt?: Date;
  /** Puerto por el que salir si vence sin respuesta. */
  timeoutPort?: string;
  eventKey?: string;
}

export interface ResultadoNodo {
  tipo: ResultadoTipo;
  /** Puerto por el que continuar. Obligatorio si `tipo` es `continuar`. */
  puerto?: string;
  /** Variables que el nodo aporta al contexto. */
  variables?: ContextoVariables;
  espera?: EsperaSolicitada;
  /** Clasificador redactado. NUNCA el mensaje crudo del proveedor. */
  errorCode?: string;
  claseError?: ClaseError;
  /** Motivo de fin, cancelación o transferencia. */
  motivo?: string;
  /** Datos seguros para el historial. Ya redactados. */
  meta?: Record<string, unknown>;
}

export const continuar = (
  puerto: string,
  variables?: ContextoVariables,
  meta?: Record<string, unknown>,
): ResultadoNodo => ({ tipo: 'continuar', puerto, variables, meta });

export const esperar = (
  espera: EsperaSolicitada,
  meta?: Record<string, unknown>,
): ResultadoNodo => ({ tipo: 'esperar', espera, meta });

export const terminar = (motivo?: string): ResultadoNodo => ({
  tipo: 'terminar',
  motivo,
});

export const cancelar = (motivo?: string): ResultadoNodo => ({
  tipo: 'cancelar',
  motivo,
});

export const handoff = (
  motivo?: string,
  meta?: Record<string, unknown>,
): ResultadoNodo => ({ tipo: 'handoff', motivo, meta });

export const fallo = (
  errorCode: string,
  claseError: ClaseError,
  meta?: Record<string, unknown>,
): ResultadoNodo => ({ tipo: 'error', errorCode, claseError, meta });

// ── contexto que recibe un ejecutor ───────────────────────────

/**
 * Lo ÚNICO que ve un ejecutor de nodo.
 *
 * Deliberadamente estrecho: no recibe Prisma, ni el módulo de Nest, ni la
 * petición. Un nodo no puede consultar otra empresa porque no tiene con qué.
 */
export interface ContextoNodo {
  companyId: string;
  executionId: string;
  correlationId: string;
  conversationId: string | null;
  contactId: string | null;
  leadId: string | null;
  whatsappIntegrationId: string | null;
  /** Nodo compilado, ya con su configuración interpolada. */
  nodo: NodoCompilado;
  /** Config con las variables ya sustituidas. */
  config: Record<string, unknown>;
  /** Variables acumuladas de la ejecución. Solo lectura. */
  variables: Readonly<ContextoVariables>;
  /** Texto del mensaje que reanudó la ejecución, si la reanudó uno. */
  entrada?: string;
  /** Nº de paso dentro de la ejecución. Para la clave de idempotencia. */
  paso: number;
  /** Intento actual de ESTE nodo. */
  intento: number;
  efectos: Efectos;
}

/** Un ejecutor: recibe contexto, devuelve resultado. Nada más. */
export type EjecutorNodo = (ctx: ContextoNodo) => Promise<ResultadoNodo>;

// ── puertos ───────────────────────────────────────────────────

export interface PuertoMensajeria {
  /**
   * `idempotencyKey` va en el puerto y no en el motor a propósito: cada
   * adaptador sabe cómo evitar el duplicado en SU medio. El real lo usa para
   * no reenviar tras un reintento; el falso, para contar.
   */
  enviarTexto(input: {
    companyId: string;
    conversationId: string;
    texto: string;
    idempotencyKey: string;
  }): Promise<{ wamid?: string }>;

  enviarPlantilla(input: {
    companyId: string;
    conversationId: string;
    plantilla: string;
    parametros: string[];
    idempotencyKey: string;
  }): Promise<{ wamid?: string }>;

  enviarMedio(input: {
    companyId: string;
    conversationId: string;
    tipo: 'image' | 'document' | 'audio' | 'video';
    url: string;
    caption?: string;
    filename?: string;
    idempotencyKey: string;
  }): Promise<{ wamid?: string }>;

  enviarOpciones(input: {
    companyId: string;
    conversationId: string;
    texto: string;
    opciones: string[];
    formato: 'buttons' | 'list';
    idempotencyKey: string;
  }): Promise<{ wamid?: string }>;

  /**
   * ¿Se puede escribir texto libre ahora?
   *
   * Fuera de la ventana de servicio de Meta solo entra una plantilla
   * aprobada. Preguntarlo es responsabilidad del motor, no del nodo: así la
   * regla se aplica igual en todos los nodos que escriben.
   */
  dentroDeVentana(input: {
    companyId: string;
    conversationId: string;
  }): Promise<boolean>;
}

export interface PuertoCrm {
  guardarContacto(input: {
    companyId: string;
    contactId: string | null;
    nombre?: string;
    email?: string;
    telefono?: string;
    idempotencyKey: string;
  }): Promise<{ contactId: string }>;

  etiquetar(input: {
    companyId: string;
    contactId: string;
    etiqueta: string;
    accion: 'add' | 'remove';
  }): Promise<void>;

  campoPersonalizado(input: {
    companyId: string;
    contactId: string;
    campo: string;
    valor: string;
  }): Promise<void>;

  /**
   * Campo personalizado de la OPORTUNIDAD, no del contacto.
   *
   * Son dos operaciones y no una con bandera porque un dato del negocio
   * —«presupuesto aprobado»— pertenece a la oportunidad: guardarlo en el
   * contacto lo arrastraría a la siguiente venta, donde ya no es cierto.
   */
  campoOportunidad(input: {
    companyId: string;
    leadId: string;
    campo: string;
    valor: string;
  }): Promise<void>;

  /**
   * Archiva un contacto sin borrar nada.
   *
   * Conserva conversaciones, oportunidades e historial. Distinto de bloquear:
   * archivar es «ya no está activo», bloquear es una decisión sobre la
   * relación.
   */
  archivarContacto(input: {
    companyId: string;
    contactId: string;
    motivo?: string;
  }): Promise<void>;

  crearOportunidad(input: {
    companyId: string;
    contactId: string | null;
    conversationId: string | null;
    titulo: string;
    pipelineId: string;
    stageId: string;
    valor?: number;
    idempotencyKey: string;
  }): Promise<{ leadId: string }>;

  moverEtapa(input: {
    companyId: string;
    leadId: string;
    stageId: string;
  }): Promise<void>;

  valorOportunidad(input: {
    companyId: string;
    leadId: string;
    valor: number;
  }): Promise<void>;

  asignar(input: {
    companyId: string;
    leadId: string;
    userId: string;
  }): Promise<void>;

  /** Devuelve a quién le toca, sin asignarlo: el motor decide qué hacer. */
  siguienteEnTurno(input: {
    companyId: string;
    conversationId: string | null;
  }): Promise<{ userId: string; nombre: string } | null>;

  cerrarOportunidad(input: {
    companyId: string;
    leadId: string;
    resultado: 'ganada' | 'perdida';
    motivo?: string;
  }): Promise<void>;

  crearTarea(input: {
    companyId: string;
    titulo: string;
    conversationId: string | null;
    contactId: string | null;
    leadId: string | null;
    assignedTo?: string;
    venceEn?: Date;
    prioridad?: string;
    idempotencyKey: string;
  }): Promise<{ taskId: string }>;

  notaInterna(input: {
    companyId: string;
    conversationId: string;
    texto: string;
    idempotencyKey: string;
  }): Promise<void>;

  cerrarConversacion(input: {
    companyId: string;
    conversationId: string;
  }): Promise<void>;

  reabrirConversacion(input: {
    companyId: string;
    conversationId: string;
  }): Promise<void>;

  /**
   * Pasa la conversación a una persona: la marca en pausa para que el bot no
   * siga respondiendo mientras hay un humano al otro lado.
   */
  transferir(input: {
    companyId: string;
    conversationId: string;
    userId?: string;
    motivo?: string;
    nota?: string;
    /** Qué nodo lo decidió, para poder explicarlo después. */
    nodeId?: string;
  }): Promise<void>;
}

export interface PuertoHttp {
  llamar(input: {
    companyId: string;
    url: string;
    metodo: string;
    cabeceras?: Record<string, string>;
    cuerpo?: unknown;
    credentialId?: string;
  }): Promise<{ estado: number; datos: unknown }>;
}

export interface PuertoIa {
  /** `false` cuando no hay proveedor: los nodos de IA salen por `fallback`. */
  disponible(companyId: string): Promise<boolean>;

  /** Elige SOLO entre las opciones dadas. No puede inventar otras. */
  clasificar(input: {
    companyId: string;
    texto: string;
    opciones: string[];
  }): Promise<{ eleccion: string | null; confianza: number }>;

  extraer(input: {
    companyId: string;
    texto: string;
    campos: string[];
  }): Promise<Record<string, string>>;

  redactar(input: {
    companyId: string;
    instrucciones: string;
    texto: string;
  }): Promise<string>;

  resumir(input: {
    companyId: string;
    conversationId: string;
  }): Promise<string>;
}

/** El reloj se inyecta para poder adelantar el tiempo en las pruebas. */
export interface PuertoReloj {
  ahora(): Date;
}

export interface PuertoAuditoria {
  registrar(input: {
    companyId: string;
    accion: string;
    entityType: string;
    entityId: string;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface Efectos {
  mensajeria: PuertoMensajeria;
  crm: PuertoCrm;
  http: PuertoHttp;
  ia: PuertoIa;
  reloj: PuertoReloj;
  auditoria: PuertoAuditoria;
}

/**
 * Clave de idempotencia de un paso.
 *
 * Lleva la ejecución, el nodo y el número de paso. El número importa: un
 * mismo nodo puede ejecutarse varias veces dentro de un bucle legítimo, y sin
 * él la segunda vuelta se tomaría por un reintento de la primera y no haría
 * nada.
 */
export function claveDePaso(
  executionId: string,
  nodeId: string,
  paso: number,
): string {
  return `${executionId}:${nodeId}:${paso}`;
}
