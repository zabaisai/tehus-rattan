import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { compilar } from '../graph/flowbot.compiler';
import { GrafoFlow } from '../graph/flowbot.graph';
import { validarGrafo } from '../graph/flowbot.validator';
import { FlowBotReferenciasService } from '../graph/flowbot.referencias.service';
import { EfectosFalsos } from '../engine/flowbot.fake-effects';
import { avanzar, ResultadoAvance } from '../engine/flowbot.interpreter';
import { Efectos } from '../engine/flowbot.ports';
import { ContextoVariables } from '../graph/flowbot.variables';
import { zonaSegura } from '../../../common/time/zona-horaria';
import {
  EntradaSimulacionDto,
  ResultadoSimulacionDto,
  aProblemaDto,
} from './flowbot.contracts';

/**
 * Simulador de FlowBot.
 *
 * USA EL MISMO CATÁLOGO, EL MISMO VALIDADOR, EL MISMO COMPILADOR Y EL MISMO
 * INTÉRPRETE que el motor real. Es la única forma de que una simulación diga
 * algo: un simulador con su propia lógica prueba el simulador, no el bot.
 *
 * LO QUE CAMBIA ES EL JUEGO DE EFECTOS, y cambia por CONSTRUCCIÓN, no por una
 * bandera. El intérprete solo conoce los puertos; aquí se le pasan adaptadores
 * falsos, así que no existe ninguna ruta de código por la que pueda escribir
 * en la base, llamar a Meta o gastar IA. No hay un `if (simulacion)` que
 * alguien pueda olvidar en un sitio.
 *
 * NO ESCRIBE NADA. Ni ejecuciones, ni pasos, ni esperas, ni contactos. Lo
 * único que consulta de la base son las REFERENCIAS de la empresa para
 * validar, y eso es de solo lectura y acotado por `companyId`.
 */
@Injectable()
export class FlowBotSimulatorService {
  private readonly logger = new Logger(FlowBotSimulatorService.name);

  /** Tope de turnos. Un flujo que pregunta en bucle no puede colgar la API. */
  private static readonly MAX_TURNOS = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly referencias: FlowBotReferenciasService,
  ) {}

  async simular(
    companyId: string,
    entrada: EntradaSimulacionDto,
  ): Promise<ResultadoSimulacionDto> {
    const grafo = entrada.graph as GrafoFlow;
    if (!grafo || typeof grafo !== 'object') {
      throw new BadRequestException('Falta el flujo a simular');
    }

    // Se valida ANTES de simular, con las referencias reales: simular un flujo
    // que no se puede publicar da una falsa sensación de que funciona.
    const referencias = await this.referencias.paraEmpresa(companyId);
    const problemas = validarGrafo(grafo, referencias);
    const errores = problemas.filter((p) => p.severidad === 'error');

    const compilacion = compilar(grafo);
    if (!compilacion.ok || !compilacion.compilado) {
      return {
        ok: false,
        estadoFinal: 'NO_COMPILA',
        ruta: [],
        nodoActual: null,
        decisiones: [],
        variablesAntes: {},
        variablesDespues: {},
        efectos: [],
        mensajes: [],
        esperas: [],
        handoff: null,
        errores: [...errores, ...(compilacion.problemas ?? [])]
          .filter((p) => p.severidad === 'error')
          .map(aProblemaDto),
        advertencias: problemas
          .filter((p) => p.severidad === 'aviso')
          .map(aProblemaDto),
        pasos: 0,
        turnos: 0,
      };
    }

    const { efectos, espia } = this.efectosDeSimulacion(entrada);
    const zona = zonaSegura(entrada.zonaHoraria);

    const variablesIniciales: ContextoVariables = {
      ...(entrada.variables ?? {}),
      contacto: {
        // Identificadores con prefijo `sim-`: si uno acabara en la base por un
        // error, se reconoce a simple vista.
        id: 'sim-contacto',
        nombre: entrada.contacto?.nombre ?? 'Cliente de prueba',
        telefono: entrada.contacto?.telefono ?? '+570000000000',
        email: entrada.contacto?.email ?? '',
        etiquetas: entrada.contacto?.etiquetas ?? [],
        campos: entrada.contacto?.campos ?? {},
      },
      conversacion: { id: 'sim-conversacion' },
      ...(entrada.oportunidad
        ? { oportunidad: { id: 'sim-oportunidad', ...entrada.oportunidad } }
        : {}),
    };
    const variablesAntes = JSON.parse(
      JSON.stringify(variablesIniciales),
    ) as ContextoVariables;

    // ── el bucle de turnos ──
    //
    // Cada vuelta es «el motor avanza hasta esperar» + «alguien responde».
    // Es exactamente lo que ocurre en producción entre dos mensajes, y por eso
    // el simulador puede recorrer un flujo con varias preguntas de una vez.
    const ruta: string[] = [];
    const decisiones: ResultadoSimulacionDto['decisiones'] = [];
    const esperas: ResultadoSimulacionDto['esperas'] = [];
    let handoff: { motivo: string } | null = null;

    let variables = variablesIniciales;
    let currentNodeId: string | null = null;
    let steps = 0;
    let turnos = 0;
    let entradaTurno = entrada.mensajeInicial;
    let porTimeout: { desdeNodo: string; puerto: string } | undefined;
    let resultado: ResultadoAvance | null = null;

    while (turnos < FlowBotSimulatorService.MAX_TURNOS) {
      resultado = await avanzar(
        compilacion.compilado,
        {
          companyId,
          executionId: 'sim-ejecucion',
          correlationId: 'sim-correlacion',
          conversationId: 'sim-conversacion',
          contactId: 'sim-contacto',
          leadId: entrada.oportunidad ? 'sim-oportunidad' : null,
          whatsappIntegrationId: entrada.whatsappIntegrationId ?? null,
          currentNodeId,
          variables,
          steps,
          zonaHoraria: zona,
          entrada: entradaTurno,
          porTimeout,
        },
        efectos,
        { maxPasos: 200 },
      );

      for (const p of resultado.pasos) {
        ruta.push(p.nodeId);
        decisiones.push({
          nodeId: p.nodeId,
          nodeType: p.nodeType,
          puerto: p.puertoSalida ?? null,
          explicacion: explicar(p),
        });
      }

      variables = resultado.variables;
      currentNodeId = resultado.currentNodeId;
      steps = resultado.steps;
      porTimeout = undefined;
      entradaTurno = undefined;

      if (resultado.espera) {
        esperas.push({
          kind: resultado.espera.kind,
          wakeAt: resultado.espera.wakeAt?.toISOString() ?? null,
          nodeId: resultado.espera.resumeNodeId,
        });
      }

      if (resultado.estado === 'HANDED_OFF') {
        handoff = { motivo: resultado.motivo ?? 'sin motivo' };
        break;
      }
      if (
        resultado.estado !== 'WAITING_INPUT' &&
        resultado.estado !== 'WAITING_TIME'
      ) {
        break;
      }

      // Está esperando: o se responde, o se fuerza el vencimiento, o se para.
      const siguiente = entrada.respuestas?.[turnos];

      if (entrada.forzarTimeout || siguiente === undefined) {
        const espera = resultado.espera;
        if (!espera?.timeoutPort || !entrada.forzarTimeout) break;
        porTimeout = {
          desdeNodo: espera.resumeNodeId,
          puerto: espera.timeoutPort,
        };
      } else {
        entradaTurno = siguiente;
      }

      // El reloj avanza SOLO si se pide: por defecto, una simulación ocurre en
      // un instante. Adelantarlo por su cuenta haría que un flujo con
      // vencimientos cortos saliera por timeout sin que nadie lo pidiera.
      if (entrada.avanzarRelojSegundos) {
        espia.reloj.avanzar(entrada.avanzarRelojSegundos * 1000);
      }
      turnos += 1;
    }

    const registro = espia.registro;

    return {
      ok: resultado?.estado !== 'FAILED',
      estadoFinal: resultado?.estado ?? 'SIN_EJECUTAR',
      ...(resultado?.motivo ? { motivo: resultado.motivo } : {}),
      ruta,
      nodoActual: currentNodeId,
      decisiones,
      variablesAntes: variablesAntes,
      variablesDespues: variables,
      efectos: registro.map((e) => ({
        puerto: e.puerto,
        operacion: e.operacion,
        datos: e.datos,
      })),
      mensajes: registro
        .filter((e) => e.puerto === 'mensajeria')
        .map((e) => ({
          tipo: e.operacion,
          texto: comoTexto(e.datos.texto) || comoTexto(e.datos.plantilla),
        })),
      esperas,
      handoff,
      errores: [
        ...errores.map(aProblemaDto),
        ...(resultado?.estado === 'FAILED'
          ? [
              {
                codigo: resultado.errorCode ?? 'ejecucion.fallo',
                severidad: 'error' as const,
                mensaje: `La simulación terminó en error: ${resultado.errorCode ?? 'desconocido'}`,
                ...(currentNodeId ? { nodeId: currentNodeId } : {}),
              },
            ]
          : []),
      ],
      advertencias: problemas
        .filter((p) => p.severidad === 'aviso')
        .map(aProblemaDto),
      pasos: steps,
      turnos,
    };
  }

  /**
   * Construye el juego de efectos de la simulación.
   *
   * SON TODOS FALSOS. No se toma ni uno del `FlowBotEffectsFactory`: si se
   * mezclaran, bastaría con que alguien olvidara sustituir uno para que una
   * simulación escribiera en el CRM de verdad.
   */
  private efectosDeSimulacion(entrada: EntradaSimulacionDto): {
    efectos: Efectos;
    espia: EfectosFalsos;
  } {
    const espia = new EfectosFalsos({
      dentroDeVentana: !entrada.fallos?.whatsapp,
      iaDisponible: !entrada.fallos?.ia,
      ...(entrada.respuestaIa
        ? {
            clasificacion: {
              eleccion: entrada.respuestaIa.eleccion ?? null,
              confianza: entrada.respuestaIa.confianza ?? 0.9,
            },
          }
        : {}),
    });

    espia.reloj.fijar(entrada.ahora ? new Date(entrada.ahora) : new Date());

    // Los fallos se simulan envolviendo los puertos, no tocando el intérprete:
    // así el motor recorre exactamente el mismo camino que recorrería con un
    // fallo real.
    const efectos: Efectos = {
      ...espia,
      reloj: espia.reloj,
      mensajeria: entrada.fallos?.whatsapp
        ? {
            ...espia.mensajeria,
            enviarTexto: async () => {
              throw Object.assign(new Error('whatsapp-simulado'), {
                clase: 'externo_definitivo',
              });
            },
          }
        : espia.mensajeria,
      http: entrada.fallos?.http
        ? {
            llamar: async () => {
              throw Object.assign(new Error('http-simulado'), {
                clase: 'externo_transitorio',
              });
            },
          }
        : entrada.respuestaHttp
          ? {
              llamar: async () => ({
                estado: entrada.respuestaHttp?.estado ?? 200,
                datos: entrada.respuestaHttp?.datos ?? null,
              }),
            }
          : espia.http,
      ia: entrada.fallos?.ia
        ? {
            ...espia.ia,
            disponible: async () => false,
          }
        : espia.ia,
    };

    return { efectos, espia };
  }
}

/**
 * El valor solo si de verdad es una cadena.
 *
 * `String(x)` sobre un `unknown` que resulte ser un objeto escribe
 * "[object Object]" y la simulación mostraría basura donde debería ir el
 * mensaje. Es la quinta vez que esta regla del linter evita el mismo error en
 * el repositorio.
 */
function comoTexto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/**
 * Por qué el flujo tomó esa salida.
 *
 * En texto y no en código porque es para una persona: quien simula quiere
 * entender la decisión, no clasificarla.
 */
function explicar(paso: {
  nodeType: string;
  puertoSalida?: string;
  errorCode?: string;
  estado: string;
}): string {
  if (paso.errorCode) {
    return `Falló con "${paso.errorCode}" y salió por la rama de error.`;
  }
  if (paso.estado === 'SKIPPED') return 'Se omitió.';

  switch (paso.puertoSalida) {
    case 'true':
      return 'La condición se cumplió.';
    case 'false':
      return 'La condición no se cumplió.';
    case 'timeout':
      return 'Venció el plazo sin respuesta.';
    case 'fallback':
      return 'Se usó la alternativa porque el camino principal no estaba disponible.';
    case 'human':
      return 'Se entregó la conversación a una persona.';
    case 'next':
      return 'Continuó al siguiente paso.';
    default:
      return paso.puertoSalida
        ? `Salió por "${paso.puertoSalida}".`
        : 'Quedó esperando.';
  }
}
