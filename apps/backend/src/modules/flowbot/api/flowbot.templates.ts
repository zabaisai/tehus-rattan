import { ConexionFlow, GrafoFlow, NodoFlow } from '../graph/flowbot.graph';

/**
 * Plantillas oficiales de FlowBot.
 *
 * SON DATOS, NO FILAS. Viven en código y se copian a un borrador cuando
 * alguien las elige. Sembrarlas como bots en cada empresa llenaría el listado
 * de ocho flujos que nadie pidió y que hay que archivar uno a uno.
 *
 * NINGUNA SE PUBLICA SOLA. Se duplican como borrador, y quien la elige tiene
 * que rellenar sus referencias y publicarla. Un bot que empieza a contestar
 * porque alguien miró el catálogo es exactamente lo que no puede pasar.
 *
 * NADA DE PROMESAS COMERCIALES. Los textos son neutros y no prometen plazos,
 * descuentos ni disponibilidad: lo que una plantilla diga se lo dice a un
 * cliente real de otra empresa, y no sabemos qué puede cumplir.
 *
 * NADA ESPECÍFICO DE TEHUS. Ni productos, ni precios, ni nombres propios.
 */

export interface PlantillaFlowBot {
  clave: string;
  nombre: string;
  descripcion: string;
  objetivo: string;
  categoria:
    | 'captacion'
    | 'calificacion'
    | 'seguimiento'
    | 'servicio'
    | 'operacion';
  /**
   * Qué tiene que completar quien la use antes de publicar, en lenguaje
   * llano.
   */
  requiere: string[];

  /**
   * Los campos concretos que quedan vacíos a propósito, como `nodo.campo`.
   *
   * UNA PLANTILLA CON REFERENCIAS DE EMPRESA NO PUEDE VALIDAR TAL CUAL, y eso
   * es correcto: nadie puede elegir por el cliente a qué etapa mover una
   * oportunidad ni qué plantilla de WhatsApp usar. Poner una de ejemplo sería
   * peor, porque alguien publicaría sin cambiarla y le mandaría a su cliente
   * el catálogo de otro.
   *
   * Se declara aquí para que la interfaz pueda pedirlos antes de publicar, y
   * para que las pruebas comprueben que los ÚNICOS errores de una plantilla
   * son exactamente estos y ninguno más.
   */
  camposPorCompletar: string[];

  graph: GrafoFlow;
}

const nodo = (
  id: string,
  type: NodoFlow['type'],
  config: Record<string, unknown> = {},
  position = { x: 0, y: 0 },
): NodoFlow => ({ id, type, position, config });

const con = (from: string, fromPort: string, to: string): ConexionFlow => ({
  id: `${from}:${fromPort}->${to}`,
  from,
  fromPort,
  to,
});

/** Coloca los nodos en una rejilla legible: el editor los abre así. */
function enFila(
  ids: string[],
  y = 0,
): Record<string, { x: number; y: number }> {
  const posiciones: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    posiciones[id] = { x: 80 + i * 260, y };
  });
  return posiciones;
}

/**
 * Arma el grafo colocando TODOS los nodos, no solo los de la fila principal.
 *
 * Antes, un nodo que no estuviera en `disposicion` se quedaba en `{0,0}`, y
 * como el valor por defecto es el mismo para todos, las ramas laterales
 * aparecían apiladas en el mismo punto: tres pasos dibujados uno encima de
 * otro parecen uno solo, y quien abre la plantilla cree que le falta la mitad
 * del flujo. Lo vio la QA visual, no las pruebas: un grafo con tres nodos en
 * la misma coordenada es perfectamente válido para el validador.
 *
 * Los que no estén colocados a mano caen en filas de debajo, en el orden en
 * que se declararon.
 */
function grafo(
  nodes: NodoFlow[],
  edges: ConexionFlow[],
  disposicion: Record<string, { x: number; y: number }> = {},
): GrafoFlow {
  let sueltos = 0;
  return {
    schemaVersion: 1,
    startNodeId: 'inicio',
    nodes: nodes.map((n) => {
      const colocado = disposicion[n.id];
      if (colocado) return { ...n, position: colocado };

      const i = sueltos++;
      return {
        ...n,
        position: { x: 80 + (i % 4) * 260, y: 200 + Math.floor(i / 4) * 160 },
      };
    }),
    edges,
  };
}

// ── 1. Bienvenida y calificación ────────────────────────────────

const bienvenida: PlantillaFlowBot = {
  clave: 'bienvenida-calificacion',
  nombre: 'Bienvenida y calificación',
  descripcion:
    'Saluda a quien escribe por primera vez, pregunta qué necesita y separa ' +
    'las consultas de venta de las de soporte.',
  objetivo:
    'Que cada conversación llegue al equipo correcto sin que nadie tenga que ' +
    'leerla primero.',
  categoria: 'calificacion',
  requiere: ['Revisar los textos de saludo y de las opciones'],
  camposPorCompletar: [],
  graph: grafo(
    [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('saluda', 'send.text', {
        text: 'Hola, gracias por escribirnos. ¿En qué podemos ayudarte?',
      }),
      nodo('menu', 'send.buttons', {
        text: 'Elige una opción para atenderte mejor:',
        options: [
          { label: 'Quiero comprar' },
          { label: 'Necesito soporte' },
          { label: 'Otra cosa' },
        ],
        timeoutSeconds: 3600,
      }),
      nodo('etiqueta_venta', 'crm.contact_tag', {
        tag: 'interes-compra',
        action: 'add',
      }),
      nodo('a_venta', 'crm.handoff', { reason: 'consulta-de-venta' }),
      nodo('a_soporte', 'crm.handoff', { reason: 'consulta-de-soporte' }),
      nodo('sin_respuesta', 'send.text', {
        text: 'Seguimos por aquí cuando quieras retomar la conversación.',
      }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'saluda'),
      con('saluda', 'next', 'menu'),
      // Un menú NO tiene salida "next": tiene una por opción. Es lo que
      // permite ramificar sin leer el texto de la respuesta, que en WhatsApp
      // llega distinto según pulsen el botón o escriban.
      con('menu', 'opcion:0', 'etiqueta_venta'),
      con('menu', 'opcion:1', 'a_soporte'),
      con('menu', 'opcion:2', 'a_soporte'),
      con('menu', 'timeout', 'sin_respuesta'),
      con('etiqueta_venta', 'next', 'a_venta'),
      con('sin_respuesta', 'next', 'fin'),
    ],
    enFila(['inicio', 'saluda', 'menu', 'etiqueta_venta', 'a_venta']),
  ),
};

// ── 2. Captura de datos ─────────────────────────────────────────

const captura: PlantillaFlowBot = {
  clave: 'captura-datos',
  nombre: 'Captura de datos',
  descripcion:
    'Pide nombre y correo, los valida y los guarda en el contacto antes de ' +
    'pasar la conversación a una persona.',
  objetivo:
    'Que el asesor reciba la conversación con los datos ya capturados en vez ' +
    'de tener que pedirlos otra vez.',
  categoria: 'captacion',
  requiere: ['Nada: guarda en los campos estándar del contacto'],
  camposPorCompletar: [],
  graph: grafo(
    [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('pide_nombre', 'ask.question', {
        text: 'Para atenderte mejor, ¿cuál es tu nombre?',
        saveAs: 'nombre',
        timeoutSeconds: 7200,
      }),
      nodo('pide_correo', 'ask.email', {
        text: '¿A qué correo podemos escribirte?',
        saveAs: 'correo',
        timeoutSeconds: 7200,
      }),
      nodo('guarda', 'crm.contact_upsert', {
        name: '{{flow.nombre}}',
        email: '{{flow.correo}}',
      }),
      nodo('gracias', 'send.text', {
        text: 'Gracias, {{flow.nombre}}. Un momento y te atendemos.',
      }),
      nodo('entrega', 'crm.handoff', { reason: 'datos-capturados' }),
      nodo('sin_datos', 'crm.handoff', { reason: 'sin-respuesta-en-captura' }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'pide_nombre'),
      con('pide_nombre', 'next', 'pide_correo'),
      con('pide_nombre', 'timeout', 'sin_datos'),
      con('pide_correo', 'next', 'guarda'),
      // Sin correo se sigue igual: tener el nombre ya es mejor que nada, y
      // abandonar por un dato que falta pierde la conversación entera.
      con('pide_correo', 'timeout', 'guarda'),
      con('guarda', 'next', 'gracias'),
      con('guarda', 'error', 'fin'),
      con('gracias', 'next', 'entrega'),
    ],
    enFila([
      'inicio',
      'pide_nombre',
      'pide_correo',
      'guarda',
      'gracias',
      'entrega',
    ]),
  ),
};

// ── 3. Entrega de catálogo ──────────────────────────────────────

const catalogo: PlantillaFlowBot = {
  clave: 'entrega-catalogo',
  nombre: 'Entrega de catálogo',
  descripcion:
    'Envía un documento con la información de productos y registra el ' +
    'interés en el contacto.',
  objetivo: 'Responder al instante a quien pide información.',
  categoria: 'captacion',
  requiere: [
    'La URL pública del documento (debe ser https)',
    'Revisar el texto de acompañamiento',
  ],
  camposPorCompletar: ['envia.url'],
  graph: grafo(
    [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('anuncia', 'send.text', {
        text: 'Con gusto. Te comparto la información en un documento.',
      }),
      nodo('envia', 'send.document', {
        // Se deja vacío A PROPÓSITO: el validador lo marcará como obligatorio
        // y quien use la plantilla tendrá que poner su documento. Poner una
        // URL de ejemplo haría que alguien publicara sin cambiarla.
        url: '',
        filename: 'catalogo.pdf',
        caption: 'Aquí tienes la información.',
      }),
      nodo('etiqueta', 'crm.contact_tag', {
        tag: 'recibio-catalogo',
        action: 'add',
      }),
      nodo('pregunta', 'ask.question', {
        text: '¿Hay algo puntual que quieras consultar?',
        saveAs: 'consulta',
        timeoutSeconds: 86400,
      }),
      nodo('entrega', 'crm.handoff', { reason: 'consulta-tras-catalogo' }),
      nodo('cierra', 'send.text', {
        text: 'Quedamos atentos si necesitas algo más.',
      }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'anuncia'),
      con('anuncia', 'next', 'envia'),
      con('envia', 'next', 'etiqueta'),
      // Si el envío falla se avisa y se entrega: dejar al cliente esperando un
      // documento que nunca llega es peor que decírselo.
      con('envia', 'error', 'entrega'),
      con('etiqueta', 'next', 'pregunta'),
      con('pregunta', 'next', 'entrega'),
      con('pregunta', 'timeout', 'cierra'),
      con('cierra', 'next', 'fin'),
    ],
    enFila(['inicio', 'anuncia', 'envia', 'etiqueta', 'pregunta', 'entrega']),
  ),
};

// ── 4. Seguimiento tras catálogo sin respuesta ──────────────────

const seguimientoCatalogo: PlantillaFlowBot = {
  clave: 'seguimiento-catalogo',
  nombre: 'Seguimiento después de catálogo sin respuesta',
  descripcion:
    'Espera un día y retoma la conversación con quien recibió información y ' +
    'no contestó.',
  objetivo: 'Recuperar conversaciones que se enfriaron sin insistir de más.',
  categoria: 'seguimiento',
  requiere: [
    'Una plantilla de WhatsApp aprobada para escribir fuera de las 24 horas',
    'Ajustar la frecuencia del disparador',
  ],
  camposPorCompletar: ['plantilla.templateName'],
  graph: grafo(
    [
      // `trigger.schedule` y no un disparador de "sin respuesta": ese tipo no
      // existe en el catalogo. Quien use la plantilla configura el disparador
      // con el filtro que corresponda a su operacion.
      nodo('inicio', 'trigger.schedule', { cron: '0 10 * * 1-5' }),
      nodo('espera', 'control.wait_duration', { seconds: 86400 }),
      // NO hace falta preguntar si estamos dentro de la ventana de 24 h: el
      // motor ya lo comprueba antes de escribir texto libre y saca el flujo
      // por la rama de error. Aquí esa rama va a la plantilla aprobada, que
      // es lo único que Meta acepta fuera de la ventana.
      nodo('retoma', 'send.text', {
        text: '¿Pudiste revisar la información? Quedo atento a tus preguntas.',
      }),
      nodo('plantilla', 'send.template', { templateName: '', params: [] }),
      nodo('pregunta', 'ask.question', {
        text: '¿Te ayudo con algo puntual?',
        saveAs: 'respuesta',
        timeoutSeconds: 172800,
      }),
      nodo('entrega', 'crm.handoff', { reason: 'retomo-tras-seguimiento' }),
      nodo('etiqueta_frio', 'crm.contact_tag', {
        tag: 'sin-respuesta',
        action: 'add',
      }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'espera'),
      con('espera', 'next', 'retoma'),
      con('retoma', 'next', 'pregunta'),
      // Fuera de la ventana, el envío falla y se cae a la plantilla aprobada.
      con('retoma', 'error', 'plantilla'),
      con('plantilla', 'next', 'pregunta'),
      con('plantilla', 'error', 'etiqueta_frio'),
      con('pregunta', 'next', 'entrega'),
      con('pregunta', 'timeout', 'etiqueta_frio'),
      con('etiqueta_frio', 'next', 'fin'),
    ],
    enFila(['inicio', 'espera', 'retoma', 'pregunta', 'entrega']),
  ),
};

// ── 5. Seguimiento de cotización sin respuesta ──────────────────

const seguimientoCotizacion: PlantillaFlowBot = {
  clave: 'seguimiento-cotizacion',
  nombre: 'Seguimiento de cotización sin respuesta',
  descripcion:
    'Retoma con quien recibió una cotización y no ha respondido, y ofrece ' +
    'resolver dudas antes de darla por perdida.',
  objetivo: 'No perder una venta por silencio.',
  categoria: 'seguimiento',
  requiere: [
    'La etapa del pipeline a la que mover si no hay respuesta',
    'Una plantilla aprobada para escribir fuera de las 24 horas',
  ],
  camposPorCompletar: ['plantilla.templateName', 'mueve.stageId'],
  graph: grafo(
    [
      // `trigger.schedule` y no un disparador de "sin respuesta": ese tipo no
      // existe en el catalogo. Quien use la plantilla configura el disparador
      // con el filtro que corresponda a su operacion.
      nodo('inicio', 'trigger.schedule', { cron: '0 10 * * 1-5' }),
      nodo('espera', 'control.wait_duration', { seconds: 172800 }),
      nodo('horario', 'control.business_hours', {
        fromHour: 8,
        toHour: 18,
        days: [1, 2, 3, 4, 5],
        // Espera a que abra en vez de escribir de madrugada: un mensaje
        // comercial a las 3 de la mañana molesta más de lo que vende.
        waitUntilOpen: true,
      }),
      nodo('plantilla', 'send.template', { templateName: '', params: [] }),
      nodo('pregunta', 'ask.question', {
        text: '¿Tienes alguna duda sobre lo que te enviamos?',
        saveAs: 'duda',
        timeoutSeconds: 259200,
      }),
      nodo('entrega', 'crm.handoff', { reason: 'duda-sobre-cotizacion' }),
      nodo('mueve', 'crm.lead_stage', { stageId: '' }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'espera'),
      con('espera', 'next', 'horario'),
      con('horario', 'true', 'plantilla'),
      con('horario', 'false', 'plantilla'),
      con('horario', 'timeout', 'plantilla'),
      con('plantilla', 'next', 'pregunta'),
      con('plantilla', 'error', 'mueve'),
      con('pregunta', 'next', 'entrega'),
      con('pregunta', 'timeout', 'mueve'),
      con('mueve', 'next', 'fin'),
      con('mueve', 'error', 'fin'),
    ],
    enFila(['inicio', 'espera', 'horario', 'plantilla', 'pregunta', 'entrega']),
  ),
};

// ── 6. Fuera de horario ─────────────────────────────────────────

const fueraDeHorario: PlantillaFlowBot = {
  clave: 'fuera-de-horario',
  nombre: 'Fuera de horario',
  descripcion:
    'Avisa de que nadie está disponible ahora y deja la conversación lista ' +
    'para el equipo cuando abra.',
  objetivo:
    'Que quien escribe de noche sepa cuándo le van a contestar en vez de ' +
    'quedarse esperando.',
  categoria: 'servicio',
  requiere: ['Ajustar el horario de apertura y cierre a tu operación'],
  camposPorCompletar: [],
  graph: grafo(
    [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('horario', 'control.business_hours', {
        fromHour: 8,
        toHour: 18,
        days: [1, 2, 3, 4, 5],
      }),
      nodo('abierto', 'crm.handoff', { reason: 'dentro-de-horario' }),
      nodo('avisa', 'send.text', {
        // Sin prometer una hora concreta: no sabemos la carga del equipo.
        text:
          'Gracias por escribirnos. En este momento no hay nadie disponible. ' +
          'Te respondemos en cuanto abramos.',
      }),
      nodo('nota', 'conversation.note', {
        text: 'El cliente escribió fuera del horario de atención.',
      }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'horario'),
      con('horario', 'true', 'abierto'),
      con('horario', 'false', 'avisa'),
      con('avisa', 'next', 'nota'),
      con('avisa', 'error', 'nota'),
      con('nota', 'next', 'fin'),
    ],
    enFila(['inicio', 'horario', 'avisa', 'nota', 'fin']),
  ),
};

// ── 7. Handoff a asesor ─────────────────────────────────────────

const handoffAsesor: PlantillaFlowBot = {
  clave: 'handoff-asesor',
  nombre: 'Handoff a asesor',
  descripcion:
    'Detecta que la persona quiere hablar con alguien y entrega la ' +
    'conversación con una nota de contexto.',
  objetivo: 'Que pedir «quiero hablar con alguien» funcione siempre.',
  categoria: 'servicio',
  requiere: [
    'Revisar las palabras que activan la entrega',
    'Nada más: entrega a la bandeja común o a quien ya la tuviera',
  ],
  camposPorCompletar: [],
  graph: grafo(
    [
      nodo('inicio', 'trigger.keyword', {
        keywords: ['asesor', 'humano', 'persona', 'hablar con alguien'],
      }),
      nodo('confirma', 'send.text', {
        text: 'Claro, te comunico con una persona del equipo.',
      }),
      nodo('nota', 'conversation.note', {
        text: 'El cliente pidió hablar con una persona.',
      }),
      nodo('tarea', 'crm.task_create', {
        title: 'Atender conversación derivada del bot',
      }),
      nodo('entrega', 'crm.handoff', { reason: 'el-cliente-lo-pidio' }),
    ],
    [
      con('inicio', 'next', 'confirma'),
      con('confirma', 'next', 'nota'),
      // Aunque falle el aviso, la entrega ocurre: lo importante es que llegue
      // a una persona, no que el cliente vea la confirmación.
      con('confirma', 'error', 'nota'),
      con('nota', 'next', 'tarea'),
      con('tarea', 'next', 'entrega'),
      con('tarea', 'error', 'entrega'),
    ],
    enFila(['inicio', 'confirma', 'nota', 'tarea', 'entrega']),
  ),
};

// ── 8. Reactivación de lead ─────────────────────────────────────

const reactivacion: PlantillaFlowBot = {
  clave: 'reactivacion-lead',
  nombre: 'Reactivación de lead',
  descripcion:
    'Escribe a contactos que llevan tiempo sin actividad y separa a quien ' +
    'sigue interesado de quien no.',
  objetivo: 'Recuperar oportunidades frías sin gastar tiempo del equipo.',
  categoria: 'seguimiento',
  requiere: [
    'Una plantilla de WhatsApp aprobada',
    'La etapa a la que mover si no hay interés',
  ],
  camposPorCompletar: ['plantilla.templateName', 'mueve.stageId'],
  graph: grafo(
    [
      nodo('inicio', 'trigger.schedule', { cron: '0 9 * * 2' }),
      nodo('horario', 'control.business_hours', {
        fromHour: 9,
        toHour: 17,
        days: [1, 2, 3, 4, 5],
        waitUntilOpen: true,
      }),
      nodo('plantilla', 'send.template', { templateName: '', params: [] }),
      nodo('menu', 'send.buttons', {
        text: '¿Sigues interesado?',
        options: [{ label: 'Sí, cuéntame' }, { label: 'Ahora no' }],
        timeoutSeconds: 259200,
      }),
      nodo('etiqueta_activo', 'crm.contact_tag', {
        tag: 'reactivado',
        action: 'add',
      }),
      nodo('entrega', 'crm.handoff', { reason: 'lead-reactivado' }),
      nodo('mueve', 'crm.lead_stage', { stageId: '' }),
      nodo('fin', 'control.end'),
    ],
    [
      con('inicio', 'next', 'horario'),
      con('horario', 'true', 'plantilla'),
      con('horario', 'false', 'plantilla'),
      con('horario', 'timeout', 'plantilla'),
      con('plantilla', 'next', 'menu'),
      con('plantilla', 'error', 'fin'),
      // Una salida por opción, no "next": el menú ya ramifica.
      con('menu', 'opcion:0', 'etiqueta_activo'),
      con('menu', 'opcion:1', 'mueve'),
      con('menu', 'timeout', 'mueve'),
      con('etiqueta_activo', 'next', 'entrega'),
      con('mueve', 'next', 'fin'),
      con('mueve', 'error', 'fin'),
    ],
    enFila(['inicio', 'horario', 'plantilla', 'menu', 'entrega']),
  ),
};

export const PLANTILLAS: PlantillaFlowBot[] = [
  bienvenida,
  captura,
  catalogo,
  seguimientoCatalogo,
  seguimientoCotizacion,
  fueraDeHorario,
  handoffAsesor,
  reactivacion,
];

export function plantillaPorClave(clave: string): PlantillaFlowBot | null {
  return PLANTILLAS.find((p) => p.clave === clave) ?? null;
}
