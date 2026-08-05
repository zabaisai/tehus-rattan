/**
 * Cómo se decide si FlowBot manda un WhatsApp de verdad.
 *
 * TRES MODOS, ELEGIDOS EN UN SOLO SITIO:
 *
 *   falso    el transporte devuelve un `wamid` inventado. Nada sale del
 *            proceso. Es el modo por defecto y lo seguirá siendo hasta que
 *            alguien encienda lo demás a mano.
 *   dry-run  se ejecuta TODO —resolver el número, comprobar la ventana, la
 *            plantilla, la idempotencia, el límite de frecuencia— y se
 *            construye la petición exacta que se habría mandado, pero no se
 *            abre ninguna conexión. Sirve para ver qué haría el sistema con
 *            datos reales sin arriesgar un mensaje a un cliente.
 *   real     sale de verdad.
 *
 * LA AUSENCIA DE CONFIGURACIÓN EQUIVALE A BLOQUEADO. Todas las banderas tienen
 * el valor seguro por defecto y hay que escribir cada una a mano para llegar a
 * `real`. Es lo contrario del patrón habitual —«si no está desactivado,
 * envía»—, que convierte un `.env` incompleto en mensajes a clientes reales.
 *
 * LOS GUARDARRAÍLES SE EVALÚAN TODOS, aunque el primero ya bloquee. Un informe
 * que dice «falta la bandera global» y esconde que además la empresa no está
 * en la lista obliga a descubrir los problemas de uno en uno, activando cosas
 * por el camino.
 */
export type ModoTransporte = 'falso' | 'dry-run' | 'real';

/** Cada guardarraíl, con el nombre que sale en la explicación. */
export const GUARDARRAILES = {
  FLAG_GLOBAL: 'flag-global-apagada',
  KILL_SWITCH: 'kill-switch-activo',
  EMPRESA_NO_PERMITIDA: 'empresa-no-permitida',
  NUMERO_NO_PERMITIDO: 'numero-remitente-no-permitido',
  DESTINATARIO_NO_PERMITIDO: 'destinatario-no-permitido',
  INTEGRACION_NO_CONECTADA: 'integracion-no-conectada',
  BOT_NO_PUBLICADO: 'bot-no-publicado',
  BOT_NO_ACTIVO: 'bot-no-activo',
  VERSION_INVALIDA: 'version-invalida',
  EJECUCION_NO_VIVA: 'ejecucion-no-viva',
  HANDOFF_HUMANO: 'handoff-humano-activo',
  SIN_IDEMPOTENCIA: 'sin-clave-de-idempotencia',
  VENTANA_O_PLANTILLA: 'fuera-de-ventana-sin-plantilla',
  LIMITE_FRECUENCIA: 'limite-de-frecuencia',
  CIRCUITO_ABIERTO: 'circuito-abierto',
} as const;

export type Guardarrail = (typeof GUARDARRAILES)[keyof typeof GUARDARRAILES];

export interface DecisionTransporte {
  modo: ModoTransporte;
  /** Guardarraíles que impidieron llegar a `real`. Vacío si se llegó. */
  bloqueos: Guardarrail[];
  /** Frase corta para quien mire la pantalla o el registro. */
  explicacion: string;

  /**
   * `true` si este envío YA consumió cupo de frecuencia.
   *
   * Importa para el reintento: un envío que consumió y falló de forma ambigua
   * NO devuelve el cupo, porque puede que el mensaje saliera.
   */
  cupoConsumido?: boolean;
  /** Redis no respondió. Para el modo real esto bloquea. */
  contadorIndisponible?: boolean;
  /** Segundos hasta que vuelva a haber cupo, cuando lo cortó la frecuencia. */
  retryAfterSegundos?: number;
  /** Qué contador cortó. Sin identificadores de nadie. */
  limiteAlcanzado?: { dimension: string; ventana: string; limite: number };
  /** Este envío es la única prueba admitida en HALF_OPEN. */
  esPruebaDelBreaker?: boolean;
}

/**
 * Configuración estática, la que vive en el entorno.
 *
 * SE LEE EN CADA LLAMADA y no se memoriza en el arranque. Memorizarla
 * significaría que apagar la bandera exige reiniciar el proceso, y el momento
 * en que hace falta apagarla es justo cuando reiniciar es lo más caro.
 */
export interface ConfiguracionEnvio {
  /** `FLOWBOT_REAL_WHATSAPP_ENABLED`. Por defecto `false`. */
  realHabilitado: boolean;
  /** `FLOWBOT_WHATSAPP_DRY_RUN`. Por defecto `true`. */
  dryRun: boolean;
  /** `FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST`. Vacía = ninguna empresa. */
  empresas: string[];
  /** `FLOWBOT_WHATSAPP_PHONE_ALLOWLIST`. Vacía = ningún remitente. */
  numeros: string[];
  /** `FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST`. Vacía = ningún destinatario. */
  destinatarios: string[];
}

function lista(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** `true` SOLO con el texto exacto. Cualquier otra cosa es `false`. */
function encendido(valor: string | undefined): boolean {
  return valor?.trim().toLowerCase() === 'true';
}

/** `false` SOLO con el texto exacto. Cualquier otra cosa deja el seguro. */
function apagado(valor: string | undefined): boolean {
  return valor?.trim().toLowerCase() === 'false';
}

export function leerConfiguracion(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguracionEnvio {
  return {
    realHabilitado: encendido(env.FLOWBOT_REAL_WHATSAPP_ENABLED),
    // El dry-run solo se apaga escribiendo `false` literal. Una variable mal
    // escrita —`FALSE_`, `0`, vacía— deja el modo seguro en vez de quitarlo.
    dryRun: !apagado(env.FLOWBOT_WHATSAPP_DRY_RUN),
    empresas: lista(env.FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST),
    numeros: lista(env.FLOWBOT_WHATSAPP_PHONE_ALLOWLIST),
    destinatarios: lista(env.FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST),
  };
}

/** Lo que se sabe del envío concreto en el momento de decidir. */
export interface ContextoEnvio {
  companyId: string;
  /** Remitente ya resuelto, nunca elegido al azar. */
  phoneNumberId: string | null;
  /** Destinatario en E.164 sin `+`. */
  destinatario: string | null;
  integracionConectada: boolean;
  botPublicado: boolean;
  botActivo: boolean;
  versionValida: boolean;
  ejecucionViva: boolean;
  handoffHumano: boolean;
  idempotencyKey: string | null;
  /** Dentro de la ventana de 24 h o es una plantilla válida. */
  ventanaOPlantilla: boolean;
  dentroDeLimite: boolean;
  circuitoSano: boolean;
  /** Interruptor de emergencia. `true` = todo bloqueado. */
  killSwitch: boolean;
}

/**
 * Normaliza un teléfono para comparar contra la lista.
 *
 * Se compara por dígitos: la lista puede estar escrita con `+`, con espacios o
 * sin nada, y una diferencia de formato no puede ser la razón por la que un
 * envío de prueba salga hacia alguien que no estaba en la lista.
 */
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

export function decidirModo(
  contexto: ContextoEnvio,
  config: ConfiguracionEnvio = leerConfiguracion(),
): DecisionTransporte {
  const bloqueos: Guardarrail[] = [];

  // 1. La bandera global. Sin ella no se llega a real ni con todo lo demás.
  if (!config.realHabilitado) bloqueos.push(GUARDARRAILES.FLAG_GLOBAL);

  // 2. El interruptor de emergencia manda sobre todo lo demás.
  if (contexto.killSwitch) bloqueos.push(GUARDARRAILES.KILL_SWITCH);

  // 3-5. Listas de permitidos. VACÍA SIGNIFICA NINGUNO, no «todos»: es la
  // diferencia entre olvidarse de configurar y abrir el envío a todo el mundo.
  if (!config.empresas.includes(contexto.companyId)) {
    bloqueos.push(GUARDARRAILES.EMPRESA_NO_PERMITIDA);
  }
  if (
    !contexto.phoneNumberId ||
    !config.numeros.includes(contexto.phoneNumberId)
  ) {
    bloqueos.push(GUARDARRAILES.NUMERO_NO_PERMITIDO);
  }
  if (
    !contexto.destinatario ||
    !config.destinatarios
      .map(soloDigitos)
      .includes(soloDigitos(contexto.destinatario))
  ) {
    bloqueos.push(GUARDARRAILES.DESTINATARIO_NO_PERMITIDO);
  }

  // 6-13. Estado real del sistema en este envío.
  if (!contexto.integracionConectada) {
    bloqueos.push(GUARDARRAILES.INTEGRACION_NO_CONECTADA);
  }
  if (!contexto.botPublicado) bloqueos.push(GUARDARRAILES.BOT_NO_PUBLICADO);
  if (!contexto.botActivo) bloqueos.push(GUARDARRAILES.BOT_NO_ACTIVO);
  if (!contexto.versionValida) bloqueos.push(GUARDARRAILES.VERSION_INVALIDA);
  if (!contexto.ejecucionViva) bloqueos.push(GUARDARRAILES.EJECUCION_NO_VIVA);
  if (contexto.handoffHumano) bloqueos.push(GUARDARRAILES.HANDOFF_HUMANO);
  if (!contexto.idempotencyKey) bloqueos.push(GUARDARRAILES.SIN_IDEMPOTENCIA);
  if (!contexto.ventanaOPlantilla) {
    bloqueos.push(GUARDARRAILES.VENTANA_O_PLANTILLA);
  }
  if (!contexto.dentroDeLimite) bloqueos.push(GUARDARRAILES.LIMITE_FRECUENCIA);
  if (!contexto.circuitoSano) bloqueos.push(GUARDARRAILES.CIRCUITO_ABIERTO);

  if (bloqueos.length === 0 && !config.dryRun) {
    return { modo: 'real', bloqueos: [], explicacion: 'Envío real habilitado' };
  }

  // Con todos los guardarraíles pasados pero el dry-run puesto, se ejecuta
  // todo y no se abre la conexión: es el paso previo a encender de verdad.
  if (bloqueos.length === 0) {
    return {
      modo: 'dry-run',
      bloqueos: [],
      explicacion: 'Modo de prueba: se prepara el envío pero no se manda',
    };
  }

  // Con guardarraíles pendientes, dry-run sigue siendo útil —enseña qué
  // faltaría— pero el modo falso es el que no depende de nada.
  return {
    modo: config.dryRun && config.realHabilitado ? 'dry-run' : 'falso',
    bloqueos,
    explicacion: explicar(bloqueos),
  };
}

const TEXTOS: Record<Guardarrail, string> = {
  [GUARDARRAILES.FLAG_GLOBAL]:
    'el envío real de FlowBot está apagado en la configuración',
  [GUARDARRAILES.KILL_SWITCH]: 'el interruptor de emergencia está activo',
  [GUARDARRAILES.EMPRESA_NO_PERMITIDA]:
    'esta empresa no está en la lista de permitidas',
  [GUARDARRAILES.NUMERO_NO_PERMITIDO]:
    'el número remitente no está en la lista de permitidos',
  [GUARDARRAILES.DESTINATARIO_NO_PERMITIDO]:
    'el destinatario no está en la lista de pruebas',
  [GUARDARRAILES.INTEGRACION_NO_CONECTADA]:
    'la integración de WhatsApp no está conectada',
  [GUARDARRAILES.BOT_NO_PUBLICADO]: 'el bot no tiene versión publicada',
  [GUARDARRAILES.BOT_NO_ACTIVO]: 'el bot no está activo',
  [GUARDARRAILES.VERSION_INVALIDA]:
    'la versión que se está ejecutando ya no es válida',
  [GUARDARRAILES.EJECUCION_NO_VIVA]:
    'la ejecución ya terminó, se canceló o está pausada',
  [GUARDARRAILES.HANDOFF_HUMANO]:
    'la conversación la está atendiendo una persona',
  [GUARDARRAILES.SIN_IDEMPOTENCIA]: 'falta la clave que evita duplicados',
  [GUARDARRAILES.VENTANA_O_PLANTILLA]:
    'pasaron más de 24 h desde el último mensaje del cliente y no es una plantilla válida',
  [GUARDARRAILES.LIMITE_FRECUENCIA]: 'se alcanzó el límite de envíos',
  [GUARDARRAILES.CIRCUITO_ABIERTO]:
    'hubo demasiados fallos seguidos y los envíos están en pausa',
};

export function explicar(bloqueos: Guardarrail[]): string {
  if (bloqueos.length === 0) return 'Sin bloqueos';
  return `No se envía porque ${bloqueos.map((b) => TEXTOS[b]).join('; ')}.`;
}
