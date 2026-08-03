import { GrafoCompilado, NodoCompilado } from '../graph/flowbot.compiler';
import { LIMITES } from '../graph/flowbot.graph';
import {
  ContextoVariables,
  interpolarConfig,
} from '../graph/flowbot.variables';
import { ejecutorDe } from './flowbot.executors';
import {
  ClaseError,
  ContextoNodo,
  Efectos,
  EsperaSolicitada,
  ResultadoNodo,
  esReintentable,
} from './flowbot.ports';

/**
 * Intérprete: avanza una ejecución hasta que se detiene.
 *
 * NO TOCA LA BASE DE DATOS. Recibe el estado, avanza y devuelve qué pasó y
 * cómo quedó. Quien persiste es el servicio que lo envuelve.
 *
 * Está separado por dos motivos concretos:
 *
 *  1. El simulador ejecuta ESTE MISMO código con efectos falsos. Si el
 *     intérprete escribiera en la base, «simular» sería otro camino distinto
 *     del real, y probaríamos algo que no es lo que ocurre en producción.
 *  2. Se puede probar entero sin base de datos ni cola, que es lo que permite
 *     tener pruebas de bucles, límites y reanudaciones que corren en
 *     milisegundos.
 */

export interface PasoRegistrado {
  nodeId: string;
  nodeType: string;
  estado: 'OK' | 'FAILED' | 'SKIPPED';
  puertoSalida?: string;
  errorCode?: string;
  claseError?: ClaseError;
  durationMs: number;
  meta?: Record<string, unknown>;
  idempotencyKey: string;
  intento: number;
}

export type EstadoEjecucion =
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'WAITING_TIME'
  | 'HANDED_OFF'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED';

export interface EstadoInicial {
  companyId: string;
  executionId: string;
  correlationId: string;
  conversationId: string | null;
  contactId: string | null;
  leadId: string | null;
  whatsappIntegrationId: string | null;
  /** Nodo por el que seguir. `null` = empezar por el inicio del grafo. */
  currentNodeId: string | null;
  variables: ContextoVariables;
  /** Pasos ya consumidos por esta ejecución. */
  steps: number;
  /** Texto que reanuda una espera de entrada, si la reanuda uno. */
  entrada?: string;
  /** Reanudación por vencimiento: se sale por el puerto de timeout. */
  porTimeout?: { desdeNodo: string; puerto: string };
  /** Intento actual, para un reintento del mismo nodo. */
  intento?: number;
}

export interface ResultadoAvance {
  estado: EstadoEjecucion;
  currentNodeId: string | null;
  variables: ContextoVariables;
  steps: number;
  pasos: PasoRegistrado[];
  espera?: EsperaSolicitada & { resumeNodeId: string };
  errorCode?: string;
  claseError?: ClaseError;
  /** Si el error admite otro intento, el motor lo reencola. */
  reintentable?: boolean;
  motivo?: string;
}

export interface OpcionesAvance {
  maxPasos?: number;
  /** Tope de pasos EN ESTA LLAMADA, para no monopolizar el worker. */
  maxPasosPorTanda?: number;
}

/** Mezcla superficial por rama, para no perder `flow.x` al añadir `flow.y`. */
function mezclar(
  base: ContextoVariables,
  extra?: ContextoVariables,
): ContextoVariables {
  if (!extra) return base;
  const salida: ContextoVariables = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const previo = salida[k];
    if (
      previo &&
      typeof previo === 'object' &&
      !Array.isArray(previo) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      salida[k] = { ...previo, ...v };
    } else {
      salida[k] = v;
    }
  }
  return salida;
}

/**
 * Avanza la ejecución.
 *
 * Se detiene en cuanto hay que esperar algo, terminar, fallar o alcanzar un
 * tope. Todo lo que ocurra queda en `pasos`, que el servicio persiste en una
 * sola transacción.
 */
export async function avanzar(
  compilado: GrafoCompilado,
  inicial: EstadoInicial,
  efectos: Efectos,
  opciones: OpcionesAvance = {},
): Promise<ResultadoAvance> {
  const maxPasos = opciones.maxPasos ?? LIMITES.MAX_PASOS_EJECUCION;
  const maxTanda = opciones.maxPasosPorTanda ?? 50;

  const pasos: PasoRegistrado[] = [];
  let variables = { ...inicial.variables };
  let steps = inicial.steps;
  let entrada = inicial.entrada;
  let intento = inicial.intento ?? 1;

  // Reanudación por vencimiento: no se ejecuta el nodo otra vez, se sale por
  // su puerto de timeout. Volver a ejecutarlo reenviaría la pregunta.
  let actual: NodoCompilado | null;
  if (inicial.porTimeout) {
    const destino =
      compilado.nodos[inicial.porTimeout.desdeNodo]?.salidas?.[
        inicial.porTimeout.puerto
      ];
    if (!destino) {
      // Sin rama de timeout conectada, vencer significa terminar. Es una
      // decisión legítima del autor y no un fallo.
      return {
        estado: 'COMPLETED',
        currentNodeId: null,
        variables,
        steps,
        pasos,
        motivo: 'venció la espera sin rama de tiempo agotado',
      };
    }
    actual = compilado.nodos[destino] ?? null;
  } else {
    const id = inicial.currentNodeId ?? compilado.startNodeId;
    actual = compilado.nodos[id] ?? null;
  }

  if (!actual) {
    return {
      estado: 'FAILED',
      currentNodeId: inicial.currentNodeId,
      variables,
      steps,
      pasos,
      errorCode: 'nodo-inexistente',
      claseError: 'configuracion',
      reintentable: false,
    };
  }

  let enTanda = 0;

  while (actual) {
    if (steps >= maxPasos) {
      // Corta un bucle que el análisis estático no descartó. Se marca como
      // fallo y no como fin normal: terminar en silencio esconde el problema.
      return {
        estado: 'FAILED',
        currentNodeId: actual.id,
        variables,
        steps,
        pasos,
        errorCode: 'limite-de-pasos',
        claseError: 'requiere_intervencion',
        reintentable: false,
        motivo: `La ejecución superó ${maxPasos} pasos.`,
      };
    }
    if (enTanda >= maxTanda) {
      // Cede el turno sin perder nada: el motor reencola y sigue después.
      return {
        estado: 'RUNNING',
        currentNodeId: actual.id,
        variables,
        steps,
        pasos,
      };
    }

    const ejecutor = ejecutorDe(actual.type, actual.config);
    if (!ejecutor) {
      return {
        estado: 'FAILED',
        currentNodeId: actual.id,
        variables,
        steps,
        pasos,
        errorCode: `nodo-no-implementado:${actual.type}`,
        claseError: 'configuracion',
        reintentable: false,
      };
    }

    // La configuración se interpola con las variables ACTUALES, justo antes de
    // ejecutar: un nodo puede depender de lo que guardó el anterior.
    const config = interpolarConfig(actual.config, variables);

    const ctx: ContextoNodo = {
      companyId: inicial.companyId,
      executionId: inicial.executionId,
      correlationId: inicial.correlationId,
      conversationId: inicial.conversationId,
      contactId: inicial.contactId,
      leadId: inicial.leadId,
      whatsappIntegrationId: inicial.whatsappIntegrationId,
      nodo: actual,
      config,
      variables,
      entrada,
      paso: steps,
      intento,
      efectos,
    };

    const inicio = Date.now();
    let resultado: ResultadoNodo;
    try {
      resultado = await ejecutor(ctx);
    } catch (error) {
      // Un ejecutor que revienta no puede tumbar la ejecución entera sin
      // dejar rastro. Se clasifica como interno —reintentable— porque casi
      // siempre lo es: un fallo de red, un tiempo agotado.
      resultado = {
        tipo: 'error',
        errorCode: nombreDeError(error),
        claseError: 'interno',
      };
    }
    const durationMs = Date.now() - inicio;

    const paso: PasoRegistrado = {
      nodeId: actual.id,
      nodeType: actual.type,
      estado: resultado.tipo === 'error' ? 'FAILED' : 'OK',
      puertoSalida: resultado.puerto,
      errorCode: resultado.errorCode,
      claseError: resultado.claseError,
      durationMs,
      meta: resultado.meta,
      idempotencyKey: `${inicial.executionId}:${actual.id}:${steps}`,
      intento,
    };
    pasos.push(paso);

    variables = mezclar(variables, resultado.variables);
    steps += 1;
    enTanda += 1;
    // La entrada la consume el PRIMER nodo que la recibe. Dejarla viva haría
    // que la siguiente pregunta se autorrespondiera con el mismo texto.
    entrada = undefined;
    intento = 1;

    switch (resultado.tipo) {
      case 'esperar': {
        const espera = resultado.espera!;
        return {
          estado: espera.kind === 'TIME' ? 'WAITING_TIME' : 'WAITING_INPUT',
          currentNodeId: actual.id,
          variables,
          steps,
          pasos,
          espera: { ...espera, resumeNodeId: actual.id },
        };
      }
      case 'terminar':
        return {
          estado: 'COMPLETED',
          currentNodeId: null,
          variables,
          steps,
          pasos,
          motivo: resultado.motivo,
        };
      case 'cancelar':
        return {
          estado: 'CANCELLED',
          currentNodeId: null,
          variables,
          steps,
          pasos,
          motivo: resultado.motivo,
        };
      case 'handoff':
        return {
          estado: 'HANDED_OFF',
          currentNodeId: actual.id,
          variables,
          steps,
          pasos,
          motivo: resultado.motivo,
        };
      case 'error': {
        const clase = resultado.claseError ?? 'interno';
        const salidaError = actual.salidas?.['error'];
        if (salidaError && !esReintentable(clase)) {
          // Con rama de error conectada, un fallo definitivo NO termina la
          // ejecución: sigue por donde el autor decidió.
          actual = compilado.nodos[salidaError] ?? null;
          continue;
        }
        return {
          estado: 'FAILED',
          currentNodeId: actual.id,
          variables,
          steps,
          pasos,
          errorCode: resultado.errorCode,
          claseError: clase,
          reintentable: esReintentable(clase),
        };
      }
      case 'continuar': {
        const destino = actual.salidas?.[resultado.puerto!];
        if (!destino) {
          // Una salida sin conectar termina la ejecución. El validador ya
          // avisó al publicar; aquí se registra el motivo en vez de fallar.
          return {
            estado: 'COMPLETED',
            currentNodeId: null,
            variables,
            steps,
            pasos,
            motivo: `sin continuación por "${resultado.puerto}"`,
          };
        }
        actual = compilado.nodos[destino] ?? null;
        break;
      }
    }
  }

  return {
    estado: 'COMPLETED',
    currentNodeId: null,
    variables,
    steps,
    pasos,
    motivo: 'fin del flujo',
  };
}

/** Nombre del error sin su mensaje: el mensaje puede llevar datos del cliente. */
function nombreDeError(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  return 'ErrorDesconocido';
}

/**
 * Reintento con espera creciente y algo de dispersión.
 *
 * La dispersión importa: sin ella, cien ejecuciones que fallan a la vez por
 * una caída de Meta vuelven a intentarlo todas en el mismo instante y repiten
 * la avalancha que las tumbó.
 */
export function esperaDeReintento(
  intento: number,
  semilla = Math.random(),
): number {
  const base = Math.min(1000 * 2 ** (intento - 1), 5 * 60_000);
  const dispersion = base * 0.2 * semilla;
  return Math.round(base + dispersion);
}

export const MAX_INTENTOS = 5;
