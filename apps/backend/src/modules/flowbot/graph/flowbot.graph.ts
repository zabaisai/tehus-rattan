/**
 * Contrato del grafo de FlowBot.
 *
 * ES LA ÚNICA DEFINICIÓN. El validador, el compilador, el motor, el simulador
 * y el editor leen de aquí. Tener el catálogo de nodos repetido en el frontend
 * sería garantizar que un día divergen y que se publica un flujo que el motor
 * no sabe ejecutar.
 *
 * PUERTOS, NO `next`. El chatbot v1 encadenaba nodos con un único `next`, que
 * basta para un flujo lineal y se queda corto en cuanto hay una condición: no
 * hay forma de decir «por aquí si es verdad, por allá si no». Cada nodo
 * declara sus puertos de salida y las conexiones nombran el puerto, de modo
 * que una rama sin conectar es detectable antes de publicar y no un `undefined`
 * en tiempo de ejecución.
 */

// ── categorías ─────────────────────────────────────────────────

export type CategoriaNodo =
  | 'trigger'
  | 'conversation'
  | 'control'
  | 'crm'
  | 'integration'
  | 'ai';

/** Puertos con significado fijo. Los menús generan además `opcion:<i>`. */
export const PUERTO = {
  SALIDA: 'next',
  VERDADERO: 'true',
  FALSO: 'false',
  TIMEOUT: 'timeout',
  ERROR: 'error',
  FALLBACK: 'fallback',
  HUMANO: 'human',
} as const;

export type PuertoFijo = (typeof PUERTO)[keyof typeof PUERTO];

// ── nodos y conexiones ─────────────────────────────────────────

export interface PosicionNodo {
  x: number;
  y: number;
}

export interface NodoFlow {
  id: string;
  type: TipoNodo;
  /** Posición en el lienzo. No afecta a la ejecución. */
  position: PosicionNodo;
  /** Nombre que pone el autor. Solo presentación. */
  label?: string;
  /** Configuración propia del tipo. La valida el catálogo. */
  config?: Record<string, unknown>;
}

export interface ConexionFlow {
  id: string;
  from: string;
  /** Puerto de salida del nodo origen. */
  fromPort: string;
  to: string;
}

export interface GrafoFlow {
  /** Versión del FORMATO del grafo, no del bot. Permite migrar grafos viejos. */
  schemaVersion: number;
  /** Nodo por el que empieza la ejecución. */
  startNodeId: string;
  nodes: NodoFlow[];
  edges: ConexionFlow[];
}

export const VERSION_ESQUEMA_GRAFO = 1;

// ── límites ────────────────────────────────────────────────────

/**
 * Topes duros. Existen para que un grafo no pueda convertirse en una
 * denegación de servicio contra el propio worker, ni por descuido ni a
 * propósito.
 */
export const LIMITES = {
  /** Nodos por grafo. Por encima, el editor deja de ser usable de todos modos. */
  MAX_NODOS: 300,
  MAX_CONEXIONES: 900,
  /** Pasos por ejecución. Corta bucles que el análisis estático no descartó. */
  MAX_PASOS_EJECUCION: 200,
  /** Profundidad de encadenamiento entre bots y automatizaciones. */
  MAX_PROFUNDIDAD: 3,
  MAX_LONGITUD_TEXTO: 4096,
  MAX_OPCIONES_MENU: 10,
} as const;

// ── catálogo de tipos ──────────────────────────────────────────

export type TipoNodo =
  // disparadores
  | 'trigger.inbound_message'
  | 'trigger.keyword'
  | 'trigger.conversation_created'
  | 'trigger.stage_changed'
  | 'trigger.schedule'
  | 'trigger.manual'
  // conversación
  | 'send.text'
  | 'send.template'
  | 'send.image'
  | 'send.document'
  | 'send.audio'
  | 'send.video'
  | 'send.buttons'
  | 'send.list'
  | 'ask.question'
  | 'ask.email'
  | 'ask.phone'
  | 'ask.number'
  | 'ask.date'
  | 'conversation.note'
  | 'conversation.close'
  // control
  | 'control.condition'
  | 'control.switch'
  | 'control.wait_duration'
  | 'control.wait_until'
  | 'control.random'
  | 'control.jump'
  | 'control.end'
  | 'control.cancel'
  // CRM
  | 'crm.contact_upsert'
  | 'crm.contact_tag'
  | 'crm.contact_field'
  | 'crm.lead_create'
  | 'crm.lead_stage'
  | 'crm.lead_value'
  | 'crm.lead_assign'
  | 'crm.lead_assign_round_robin'
  | 'crm.lead_close'
  | 'crm.task_create'
  | 'crm.handoff'
  // integraciones
  | 'integration.http'
  | 'integration.emit_event'
  // IA
  | 'ai.classify_intent'
  | 'ai.extract'
  | 'ai.reply'
  | 'ai.summarize'
  | 'ai.choose_branch'
  | 'ai.detect_handoff';

/** Qué campo de configuración es obligatorio y de qué tipo. */
export interface CampoConfig {
  nombre: string;
  tipo: 'texto' | 'numero' | 'booleano' | 'lista' | 'referencia' | 'objeto';
  obligatorio: boolean;
  /** Para `referencia`: a qué entidad apunta, para poder comprobar que existe. */
  referencia?:
    | 'pipeline'
    | 'stage'
    | 'user'
    | 'template'
    | 'whatsappIntegration'
    | 'credential'
    | 'tag'
    | 'customField';
  /** Máximo para textos y listas. */
  maximo?: number;
}

export interface DefinicionNodo {
  tipo: TipoNodo;
  categoria: CategoriaNodo;
  etiqueta: string;
  /** Frase corta que explica qué hace, mostrada en la paleta. */
  ayuda: string;
  /** ¿Acepta conexiones entrantes? Los disparadores no. */
  aceptaEntrada: boolean;
  /** Puertos de salida fijos. Los dinámicos los añade el compilador. */
  puertos: string[];
  /** Si genera puertos a partir de su configuración (menús, switch). */
  puertosDinamicos?: 'opciones' | 'casos';
  config: CampoConfig[];
  /** Variables que produce y quedan disponibles después. */
  produce?: string[];
  /** Detiene la ejecución esperando algo externo. */
  esperaExterna: boolean;
  /** Produce un efecto fuera del CRM (WhatsApp, HTTP, IA). */
  efectoExterno: boolean;
  /** Requiere proveedor de IA configurado. */
  requiereIA?: boolean;
  /** Rol mínimo para poder publicar un flujo que lo use. */
  rolMinimo?: 'ADMIN' | 'MANAGER';
}

const texto = (
  nombre: string,
  obligatorio = true,
  maximo = LIMITES.MAX_LONGITUD_TEXTO,
): CampoConfig => ({
  nombre,
  tipo: 'texto',
  obligatorio,
  maximo,
});

const ref = (
  nombre: string,
  referencia: NonNullable<CampoConfig['referencia']>,
  obligatorio = true,
): CampoConfig => ({ nombre, tipo: 'referencia', obligatorio, referencia });

/**
 * El catálogo. Cada entrada es el contrato completo de un tipo de nodo:
 * qué configura, qué puertos ofrece, qué variables produce y si toca el
 * mundo exterior.
 */
export const CATALOGO: Record<TipoNodo, DefinicionNodo> = {
  // ── disparadores ──────────────────────────────────────────────
  'trigger.inbound_message': {
    tipo: 'trigger.inbound_message',
    categoria: 'trigger',
    etiqueta: 'Mensaje entrante',
    ayuda: 'Arranca cuando el cliente escribe por WhatsApp.',
    aceptaEntrada: false,
    puertos: [PUERTO.SALIDA],
    config: [],
    produce: ['message.text'],
    esperaExterna: false,
    efectoExterno: false,
  },
  'trigger.keyword': {
    tipo: 'trigger.keyword',
    categoria: 'trigger',
    etiqueta: 'Palabra clave',
    ayuda: 'Arranca cuando el mensaje contiene alguna de las palabras.',
    aceptaEntrada: false,
    puertos: [PUERTO.SALIDA],
    config: [
      { nombre: 'keywords', tipo: 'lista', obligatorio: true, maximo: 50 },
    ],
    produce: ['message.text'],
    esperaExterna: false,
    efectoExterno: false,
  },
  'trigger.conversation_created': {
    tipo: 'trigger.conversation_created',
    categoria: 'trigger',
    etiqueta: 'Conversación nueva',
    ayuda: 'Arranca la primera vez que alguien escribe.',
    aceptaEntrada: false,
    puertos: [PUERTO.SALIDA],
    config: [],
    esperaExterna: false,
    efectoExterno: false,
  },
  'trigger.stage_changed': {
    tipo: 'trigger.stage_changed',
    categoria: 'trigger',
    etiqueta: 'Cambio de etapa',
    ayuda: 'Arranca cuando una oportunidad entra en una etapa.',
    aceptaEntrada: false,
    puertos: [PUERTO.SALIDA],
    config: [ref('pipelineId', 'pipeline'), ref('stageId', 'stage')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'trigger.schedule': {
    tipo: 'trigger.schedule',
    categoria: 'trigger',
    etiqueta: 'Horario',
    ayuda: 'Arranca a una hora determinada.',
    aceptaEntrada: false,
    puertos: [PUERTO.SALIDA],
    config: [texto('cron')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'trigger.manual': {
    tipo: 'trigger.manual',
    categoria: 'trigger',
    etiqueta: 'Manual',
    ayuda: 'Solo arranca cuando alguien lo lanza a mano.',
    aceptaEntrada: false,
    puertos: [PUERTO.SALIDA],
    config: [],
    esperaExterna: false,
    efectoExterno: false,
  },

  // ── conversación ──────────────────────────────────────────────
  'send.text': {
    tipo: 'send.text',
    categoria: 'conversation',
    etiqueta: 'Enviar mensaje',
    ayuda: 'Manda un texto por WhatsApp. Admite {{variables}}.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [texto('text')],
    esperaExterna: false,
    efectoExterno: true,
  },
  'send.template': {
    tipo: 'send.template',
    categoria: 'conversation',
    etiqueta: 'Enviar plantilla',
    ayuda: 'Única forma de escribir fuera de la ventana de 24 horas.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [
      ref('templateName', 'template'),
      { nombre: 'params', tipo: 'lista', obligatorio: false },
    ],
    esperaExterna: false,
    efectoExterno: true,
  },
  'send.image': {
    tipo: 'send.image',
    categoria: 'conversation',
    etiqueta: 'Enviar imagen',
    ayuda: 'Envía una imagen por URL, con pie opcional.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [texto('url'), texto('caption', false)],
    esperaExterna: false,
    efectoExterno: true,
  },
  'send.document': {
    tipo: 'send.document',
    categoria: 'conversation',
    etiqueta: 'Enviar documento',
    ayuda: 'Envía un PDF u otro fichero.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [texto('url'), texto('filename', false)],
    esperaExterna: false,
    efectoExterno: true,
  },
  'send.audio': {
    tipo: 'send.audio',
    categoria: 'conversation',
    etiqueta: 'Enviar audio',
    ayuda: 'Envía una nota de voz o audio.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [texto('url')],
    esperaExterna: false,
    efectoExterno: true,
  },
  'send.video': {
    tipo: 'send.video',
    categoria: 'conversation',
    etiqueta: 'Enviar video',
    ayuda: 'Envía un video con pie opcional.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [texto('url'), texto('caption', false)],
    esperaExterna: false,
    efectoExterno: true,
  },
  'send.buttons': {
    tipo: 'send.buttons',
    categoria: 'conversation',
    etiqueta: 'Botones',
    ayuda: 'Hasta tres botones. El cliente elige y el flujo se bifurca.',
    aceptaEntrada: true,
    puertos: [PUERTO.TIMEOUT, PUERTO.ERROR],
    puertosDinamicos: 'opciones',
    config: [
      texto('text'),
      { nombre: 'options', tipo: 'lista', obligatorio: true, maximo: 3 },
      { nombre: 'timeoutSeconds', tipo: 'numero', obligatorio: false },
    ],
    produce: ['message.choice'],
    esperaExterna: true,
    efectoExterno: true,
  },
  'send.list': {
    tipo: 'send.list',
    categoria: 'conversation',
    etiqueta: 'Lista de opciones',
    ayuda: 'Menú desplegable de hasta diez opciones.',
    aceptaEntrada: true,
    puertos: [PUERTO.TIMEOUT, PUERTO.ERROR],
    puertosDinamicos: 'opciones',
    config: [
      texto('text'),
      {
        nombre: 'options',
        tipo: 'lista',
        obligatorio: true,
        maximo: LIMITES.MAX_OPCIONES_MENU,
      },
      { nombre: 'timeoutSeconds', tipo: 'numero', obligatorio: false },
    ],
    produce: ['message.choice'],
    esperaExterna: true,
    efectoExterno: true,
  },
  'ask.question': {
    tipo: 'ask.question',
    categoria: 'conversation',
    etiqueta: 'Preguntar',
    ayuda: 'Pregunta y guarda la respuesta en una variable.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.TIMEOUT, PUERTO.ERROR],
    config: [
      texto('text'),
      texto('saveAs'),
      { nombre: 'timeoutSeconds', tipo: 'numero', obligatorio: false },
    ],
    esperaExterna: true,
    efectoExterno: true,
  },
  'ask.email': {
    tipo: 'ask.email',
    categoria: 'conversation',
    etiqueta: 'Pedir correo',
    ayuda: 'Pregunta y valida que sea un correo. Reintenta si no lo es.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.TIMEOUT, PUERTO.ERROR],
    config: [
      texto('text'),
      texto('saveAs'),
      { nombre: 'maxRetries', tipo: 'numero', obligatorio: false },
    ],
    esperaExterna: true,
    efectoExterno: true,
  },
  'ask.phone': {
    tipo: 'ask.phone',
    categoria: 'conversation',
    etiqueta: 'Pedir teléfono',
    ayuda: 'Pregunta y normaliza a E.164.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.TIMEOUT, PUERTO.ERROR],
    config: [
      texto('text'),
      texto('saveAs'),
      { nombre: 'maxRetries', tipo: 'numero', obligatorio: false },
    ],
    esperaExterna: true,
    efectoExterno: true,
  },
  'ask.number': {
    tipo: 'ask.number',
    categoria: 'conversation',
    etiqueta: 'Pedir número',
    ayuda: 'Pregunta y valida que sea numérico, con rango opcional.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.TIMEOUT, PUERTO.ERROR],
    config: [
      texto('text'),
      texto('saveAs'),
      { nombre: 'min', tipo: 'numero', obligatorio: false },
      { nombre: 'max', tipo: 'numero', obligatorio: false },
    ],
    esperaExterna: true,
    efectoExterno: true,
  },
  'ask.date': {
    tipo: 'ask.date',
    categoria: 'conversation',
    etiqueta: 'Pedir fecha',
    ayuda: 'Pregunta y valida una fecha.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.TIMEOUT, PUERTO.ERROR],
    config: [texto('text'), texto('saveAs')],
    esperaExterna: true,
    efectoExterno: true,
  },
  'conversation.note': {
    tipo: 'conversation.note',
    categoria: 'conversation',
    etiqueta: 'Nota interna',
    ayuda: 'Deja una nota para el asesor. El cliente no la ve.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA],
    config: [texto('text')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'conversation.close': {
    tipo: 'conversation.close',
    categoria: 'conversation',
    etiqueta: 'Cerrar conversación',
    ayuda: 'Marca la conversación como resuelta.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA],
    config: [],
    esperaExterna: false,
    efectoExterno: false,
  },

  // ── control ───────────────────────────────────────────────────
  'control.condition': {
    tipo: 'control.condition',
    categoria: 'control',
    etiqueta: 'Condición',
    ayuda: 'Compara un valor y sigue por verdadero o falso.',
    aceptaEntrada: true,
    puertos: [PUERTO.VERDADERO, PUERTO.FALSO],
    config: [
      texto('left'),
      texto('operator'),
      { nombre: 'right', tipo: 'texto', obligatorio: false },
    ],
    esperaExterna: false,
    efectoExterno: false,
  },
  'control.switch': {
    tipo: 'control.switch',
    categoria: 'control',
    etiqueta: 'Varias ramas',
    ayuda: 'Compara contra varios valores y sale por el que encaje.',
    aceptaEntrada: true,
    puertos: [PUERTO.FALLBACK],
    puertosDinamicos: 'casos',
    config: [
      texto('left'),
      { nombre: 'cases', tipo: 'lista', obligatorio: true, maximo: 20 },
    ],
    esperaExterna: false,
    efectoExterno: false,
  },
  'control.wait_duration': {
    tipo: 'control.wait_duration',
    categoria: 'control',
    etiqueta: 'Esperar',
    ayuda: 'Pausa el flujo un tiempo. Sobrevive a reinicios.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA],
    config: [{ nombre: 'seconds', tipo: 'numero', obligatorio: true }],
    esperaExterna: true,
    efectoExterno: false,
  },
  'control.wait_until': {
    tipo: 'control.wait_until',
    categoria: 'control',
    etiqueta: 'Esperar hasta',
    ayuda: 'Espera a una fecha, hora o al horario comercial.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA],
    config: [texto('until')],
    esperaExterna: true,
    efectoExterno: false,
  },
  'control.random': {
    tipo: 'control.random',
    categoria: 'control',
    etiqueta: 'Reparto por porcentaje',
    ayuda: 'Divide el tráfico entre dos ramas, para probar variantes.',
    aceptaEntrada: true,
    puertos: [PUERTO.VERDADERO, PUERTO.FALSO],
    config: [{ nombre: 'percent', tipo: 'numero', obligatorio: true }],
    esperaExterna: false,
    efectoExterno: false,
  },
  'control.jump': {
    tipo: 'control.jump',
    categoria: 'control',
    etiqueta: 'Ir a un paso',
    ayuda: 'Salta a otro nodo. Cuenta para el tope de pasos.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA],
    config: [texto('targetNodeId')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'control.end': {
    tipo: 'control.end',
    categoria: 'control',
    etiqueta: 'Terminar',
    ayuda: 'Fin normal del flujo.',
    aceptaEntrada: true,
    puertos: [],
    config: [texto('reason', false)],
    esperaExterna: false,
    efectoExterno: false,
  },
  'control.cancel': {
    tipo: 'control.cancel',
    categoria: 'control',
    etiqueta: 'Cancelar',
    ayuda: 'Termina marcando la ejecución como cancelada.',
    aceptaEntrada: true,
    puertos: [],
    config: [texto('reason', false)],
    esperaExterna: false,
    efectoExterno: false,
  },

  // ── CRM ───────────────────────────────────────────────────────
  'crm.contact_upsert': {
    tipo: 'crm.contact_upsert',
    categoria: 'crm',
    etiqueta: 'Guardar contacto',
    ayuda: 'Crea o actualiza el contacto con lo capturado.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [
      { nombre: 'name', tipo: 'texto', obligatorio: false },
      { nombre: 'email', tipo: 'texto', obligatorio: false },
      { nombre: 'phone', tipo: 'texto', obligatorio: false },
    ],
    produce: ['contact.id'],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.contact_tag': {
    tipo: 'crm.contact_tag',
    categoria: 'crm',
    etiqueta: 'Etiqueta',
    ayuda: 'Añade o quita una etiqueta del contacto.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [ref('tag', 'tag'), texto('action')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.contact_field': {
    tipo: 'crm.contact_field',
    categoria: 'crm',
    etiqueta: 'Campo personalizado',
    ayuda: 'Escribe un valor en un campo del contacto.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [ref('field', 'customField'), texto('value')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.lead_create': {
    tipo: 'crm.lead_create',
    categoria: 'crm',
    etiqueta: 'Crear oportunidad',
    ayuda: 'Abre una oportunidad en el pipeline elegido.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [
      texto('title'),
      ref('pipelineId', 'pipeline'),
      ref('stageId', 'stage'),
      { nombre: 'value', tipo: 'numero', obligatorio: false },
    ],
    produce: ['lead.id'],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.lead_stage': {
    tipo: 'crm.lead_stage',
    categoria: 'crm',
    etiqueta: 'Mover de etapa',
    ayuda: 'Cambia la oportunidad de etapa.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [ref('stageId', 'stage')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.lead_value': {
    tipo: 'crm.lead_value',
    categoria: 'crm',
    etiqueta: 'Valor de la oportunidad',
    ayuda: 'Fija el importe de la oportunidad.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [{ nombre: 'value', tipo: 'numero', obligatorio: true }],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.lead_assign': {
    tipo: 'crm.lead_assign',
    categoria: 'crm',
    etiqueta: 'Asignar asesor',
    ayuda: 'Asigna la oportunidad a una persona concreta.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [ref('userId', 'user')],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.lead_assign_round_robin': {
    tipo: 'crm.lead_assign_round_robin',
    categoria: 'crm',
    etiqueta: 'Repartir entre asesores',
    ayuda: 'Reparte por turnos entre quienes estén disponibles.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [],
    produce: ['agent.id'],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.lead_close': {
    tipo: 'crm.lead_close',
    categoria: 'crm',
    etiqueta: 'Cerrar oportunidad',
    ayuda: 'Marca ganada o perdida, con motivo.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [texto('result'), texto('reason', false)],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.task_create': {
    tipo: 'crm.task_create',
    categoria: 'crm',
    etiqueta: 'Crear tarea',
    ayuda: 'Crea una tarea ligada a la conversación y la oportunidad.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [
      texto('title'),
      { nombre: 'dueInHours', tipo: 'numero', obligatorio: false },
      ref('assignedTo', 'user', false),
      { nombre: 'priority', tipo: 'texto', obligatorio: false },
    ],
    produce: ['task.id'],
    esperaExterna: false,
    efectoExterno: false,
  },
  'crm.handoff': {
    tipo: 'crm.handoff',
    categoria: 'crm',
    etiqueta: 'Pasar a una persona',
    ayuda: 'Detiene el bot y avisa a un asesor.',
    aceptaEntrada: true,
    puertos: [],
    config: [
      ref('assignedTo', 'user', false),
      texto('reason', false),
      texto('note', false),
    ],
    esperaExterna: false,
    efectoExterno: false,
  },

  // ── integraciones ─────────────────────────────────────────────
  'integration.http': {
    tipo: 'integration.http',
    categoria: 'integration',
    etiqueta: 'Llamada HTTP',
    ayuda: 'Consulta un servicio externo. Solo HTTPS y destinos permitidos.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.ERROR],
    config: [
      texto('url'),
      texto('method'),
      { nombre: 'headers', tipo: 'objeto', obligatorio: false },
      { nombre: 'body', tipo: 'objeto', obligatorio: false },
      ref('credentialId', 'credential', false),
      { nombre: 'saveAs', tipo: 'texto', obligatorio: false },
    ],
    esperaExterna: false,
    efectoExterno: true,
    rolMinimo: 'ADMIN',
  },
  'integration.emit_event': {
    tipo: 'integration.emit_event',
    categoria: 'integration',
    etiqueta: 'Emitir evento',
    ayuda: 'Lanza un evento interno para las automatizaciones.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA],
    config: [
      texto('eventKey'),
      { nombre: 'payload', tipo: 'objeto', obligatorio: false },
    ],
    esperaExterna: false,
    efectoExterno: false,
  },

  // ── IA ────────────────────────────────────────────────────────
  'ai.classify_intent': {
    tipo: 'ai.classify_intent',
    categoria: 'ai',
    etiqueta: 'Clasificar intención',
    ayuda: 'Elige una intención de la lista. Solo puede elegir de ahí.',
    aceptaEntrada: true,
    puertos: [PUERTO.FALLBACK, PUERTO.ERROR],
    puertosDinamicos: 'casos',
    config: [{ nombre: 'cases', tipo: 'lista', obligatorio: true, maximo: 12 }],
    produce: ['ai.intent', 'ai.confidence'],
    esperaExterna: false,
    efectoExterno: true,
    requiereIA: true,
  },
  'ai.extract': {
    tipo: 'ai.extract',
    categoria: 'ai',
    etiqueta: 'Extraer datos',
    ayuda: 'Saca campos concretos del mensaje, con salida validada.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.FALLBACK, PUERTO.ERROR],
    config: [
      { nombre: 'fields', tipo: 'lista', obligatorio: true, maximo: 12 },
    ],
    esperaExterna: false,
    efectoExterno: true,
    requiereIA: true,
  },
  'ai.reply': {
    tipo: 'ai.reply',
    categoria: 'ai',
    etiqueta: 'Redactar respuesta',
    ayuda: 'Redacta una respuesta con las instrucciones dadas.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.FALLBACK, PUERTO.ERROR],
    config: [texto('instructions'), texto('saveAs', false)],
    produce: ['ai.reply'],
    esperaExterna: false,
    efectoExterno: true,
    requiereIA: true,
  },
  'ai.summarize': {
    tipo: 'ai.summarize',
    categoria: 'ai',
    etiqueta: 'Resumir conversación',
    ayuda: 'Resume el hilo para que el asesor se ponga al día.',
    aceptaEntrada: true,
    puertos: [PUERTO.SALIDA, PUERTO.FALLBACK, PUERTO.ERROR],
    config: [texto('saveAs', false)],
    produce: ['ai.summary'],
    esperaExterna: false,
    efectoExterno: true,
    requiereIA: true,
  },
  'ai.choose_branch': {
    tipo: 'ai.choose_branch',
    categoria: 'ai',
    etiqueta: 'Elegir rama',
    ayuda: 'Elige entre las ramas definidas. No puede inventar otras.',
    aceptaEntrada: true,
    puertos: [PUERTO.FALLBACK, PUERTO.ERROR],
    puertosDinamicos: 'casos',
    config: [{ nombre: 'cases', tipo: 'lista', obligatorio: true, maximo: 8 }],
    esperaExterna: false,
    efectoExterno: true,
    requiereIA: true,
  },
  'ai.detect_handoff': {
    tipo: 'ai.detect_handoff',
    categoria: 'ai',
    etiqueta: 'Detectar petición de humano',
    ayuda: 'Sale por «humano» si el cliente pide hablar con una persona.',
    aceptaEntrada: true,
    puertos: [PUERTO.HUMANO, PUERTO.SALIDA, PUERTO.ERROR],
    config: [],
    esperaExterna: false,
    efectoExterno: true,
    requiereIA: true,
  },
};

/** Todos los tipos, para recorrer el catálogo sin repetir la lista. */
export const TIPOS_NODO = Object.keys(CATALOGO) as TipoNodo[];

export function esTipoValido(tipo: string): tipo is TipoNodo {
  return Object.prototype.hasOwnProperty.call(CATALOGO, tipo);
}

export function definicion(tipo: TipoNodo): DefinicionNodo {
  return CATALOGO[tipo];
}

export function esDisparador(tipo: TipoNodo): boolean {
  return CATALOGO[tipo].categoria === 'trigger';
}

/**
 * Puertos reales de un nodo, incluidos los que dependen de su configuración.
 *
 * Un menú de tres opciones tiene tres puertos `opcion:0..2` más `timeout` y
 * `error`. El validador necesita esta lista para saber si una conexión apunta
 * a un puerto que existe.
 */
export function puertosDe(nodo: NodoFlow): string[] {
  const def = CATALOGO[nodo.type];
  const fijos = [...def.puertos];
  if (!def.puertosDinamicos) return fijos;

  const clave = def.puertosDinamicos === 'opciones' ? 'options' : 'cases';
  const lista = nodo.config?.[clave];
  const cuantos = Array.isArray(lista) ? lista.length : 0;
  const prefijo = def.puertosDinamicos === 'opciones' ? 'opcion' : 'caso';

  return [
    ...Array.from({ length: cuantos }, (_, i) => `${prefijo}:${i}`),
    ...fijos,
  ];
}
