import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FlowBotQueueService } from './flowbot.queue';
import { FlowBotSelectorService } from './flowbot.selector';
import { FlowBotRunnerService, OUTBOX_FLOWBOT } from './flowbot.runner';
import { HandoffService } from '../../conversations/handoff.service';

/**
 * Puerta de entrada de FlowBot para los mensajes que llegan.
 *
 * Hace DOS cosas y en este orden:
 *
 *   1. REANUDAR. Si una ejecución está esperando la respuesta del cliente en
 *      esta conversación, este mensaje ES esa respuesta.
 *   2. ARRANCAR. Si no hay nada esperando, mira si algún bot debe empezar.
 *
 * El orden no es negociable. Al revés, un cliente que contesta a la pregunta
 * de un bot arrancaría un segundo bot en vez de contestarle al primero, y
 * acabaría con dos conversaciones automáticas cruzadas.
 *
 * NO EJECUTA NADA AQUÍ. Persiste el evento y encola; quien avanza es el
 * consumidor del worker. El webhook tiene que devolver 200 rápido —Meta
 * reintenta si tarda— y un bot que piensa dentro del webhook es exactamente
 * cómo se acaba procesando el mismo mensaje tres veces.
 */

export interface MensajeParaFlowBot {
  companyId: string;
  conversationId: string;
  /** El id del mensaje EN EL CRM, no el wamid. */
  messageId: string;
  contactId?: string | null;
  leadId?: string | null;
  whatsappIntegrationId?: string | null;
  /** Solo para elegir bot por palabra clave. No viaja a la cola. */
  texto: string;
  esPrimeraConversacion?: boolean;
  correlationId?: string;
}

export interface ResultadoIntake {
  atendido: boolean;
  motivo:
    | 'reanudada'
    | 'arrancada'
    | 'conversacion-pausada'
    | 'handoff-activo'
    | 'contacto-archivado'
    | 'sin-bot'
    | 'ya-hay-ejecucion'
    | 'espera-vencida'
    | 'error';
  executionId?: string;
}

/** Estados en los que una ejecución sigue ocupando la conversación. */
const VIVAS: Prisma.EnumFlowBotExecutionStatusFilter['in'] = [
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_TIME',
];

@Injectable()
export class FlowBotIntakeService {
  private readonly logger = new Logger(FlowBotIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly cola: FlowBotQueueService,
    private readonly selector: FlowBotSelectorService,
    private readonly runner: FlowBotRunnerService,
    private readonly handoff: HandoffService,
  ) {}

  /**
   * Atiende un mensaje entrante.
   *
   * NUNCA LANZA. Un fallo de FlowBot no puede impedir que el mensaje se
   * procese: el resto del flujo —automatizaciones, aviso al asesor— tiene que
   * seguir su curso. Preferimos una conversación sin respuesta automática a un
   * mensaje perdido.
   */
  async atenderMensaje(entrada: MensajeParaFlowBot): Promise<ResultadoIntake> {
    try {
      const conversacion = await this.prisma.conversation.findFirst({
        where: { id: entrada.conversationId, companyId: entrada.companyId },
        select: {
          id: true,
          isPaused: true,
          contactId: true,
          contact: { select: { archivedAt: true } },
        },
      });

      // Pausada = un asesor tomó el control. El bot calla, igual que el
      // chatbot heredado. Que dos motores distintos respeten la misma señal es
      // lo que hace que «pausar» signifique algo para quien lo pulsa.
      if (!conversacion || conversacion.isPaused) {
        return { atendido: false, motivo: 'conversacion-pausada' };
      }

      // SEGUNDA BARRERA, y deliberadamente redundante con `isPaused`.
      //
      // El handoff mantiene `isPaused` en sincronía, así que en teoría la
      // comprobación de arriba basta. Pero `isPaused` es una bandera que
      // cualquier pantalla puede quitar sin saber que hay una entrega viva, y
      // el coste de equivocarse aquí lo paga el cliente: recibe al bot por
      // encima de la persona que le está escribiendo. La fuente de verdad de
      // «hay alguien atendiendo» es la tabla, no la bandera.
      if (
        await this.handoff.hayHandoffActivo(
          entrada.companyId,
          entrada.conversationId,
        )
      ) {
        return { atendido: false, motivo: 'handoff-activo' };
      }

      // Un contacto archivado no arranca bots. SÍ puede reanudar una
      // ejecución que ya estaba esperando su respuesta: cortarla a mitad
      // dejaría la conversación colgada sin que el cliente entienda por qué
      // dejaron de contestarle.
      const archivado = conversacion.contact?.archivedAt != null;

      const reanudada = await this.reanudarPorMensaje(entrada);
      if (reanudada) return reanudada;

      if (archivado) {
        return { atendido: false, motivo: 'contacto-archivado' };
      }

      return await this.arrancarSiProcede(entrada, conversacion.contactId);
    } catch (error) {
      this.logger.warn(
        `FlowBot no pudo atender el mensaje [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
      return { atendido: false, motivo: 'error' };
    }
  }

  /**
   * Reanuda la ejecución que estaba esperando la respuesta del cliente.
   *
   * NO CONSUME LA ESPERA AQUÍ. La consume el runner, con una escritura
   * condicional, en el momento de avanzar. Si se consumiera aquí y el proceso
   * muriera antes de escribir el evento, la ejecución quedaría despierta sin
   * nada que la despertara: la espera ya gastada y ningún trabajo en la cola.
   *
   * Devuelve `null` si no había nada que reanudar.
   */
  private async reanudarPorMensaje(
    entrada: MensajeParaFlowBot,
  ): Promise<ResultadoIntake | null> {
    const espera = await this.prisma.flowBotWait.findFirst({
      where: {
        companyId: entrada.companyId,
        kind: 'INPUT',
        consumedAt: null,
        execution: {
          conversationId: entrada.conversationId,
          status: 'WAITING_INPUT',
        },
      },
      // La más reciente: si por un fallo quedaran dos abiertas, la que
      // corresponde a la pregunta que el cliente acaba de leer es la última.
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        wakeAt: true,
        execution: {
          select: { id: true, steps: true, correlationId: true },
        },
      },
    });

    if (!espera) return null;

    // El plazo ya venció. Este mensaje llega tarde: la ejecución debe salir
    // por su puerto de tiempo agotado, no por la respuesta. Dejarlo en manos
    // del despertar evita que las dos salidas compitan por la misma espera.
    if (espera.wakeAt && espera.wakeAt <= new Date()) {
      return { atendido: false, motivo: 'espera-vencida' };
    }

    const { id: executionId, steps, correlationId } = espera.execution;

    // Orden obligatorio: persistir el evento → commit → publicar → marcar. El
    // `record` va en su propia transacción porque aquí no hay nada más que
    // escribir; lo importante es que el evento exista ANTES de encolar.
    await this.outbox.record(this.prisma, {
      type: OUTBOX_FLOWBOT.AVANZAR,
      companyId: entrada.companyId,
      // La clave identifica el HECHO «este mensaje debe avanzar esta
      // ejecución». El mismo mensaje entregado dos veces por Meta no genera
      // dos eventos.
      idempotencyKey: `${OUTBOX_FLOWBOT.AVANZAR}:${executionId}:msg:${entrada.messageId}`,
      payload: {
        executionId,
        companyId: entrada.companyId,
        waitId: espera.id,
        messageId: entrada.messageId,
        correlationId,
        paso: steps,
      },
    });

    // Atajo de latencia: si Redis responde, el cliente no espera al siguiente
    // pase del despachador. Si no responde, el evento sigue PENDING y el
    // despachador lo publicará. No se pierde, solo tarda más.
    const encolado = await this.cola.encolarMensaje({
      tipo: 'avanzar',
      companyId: entrada.companyId,
      executionId,
      waitId: espera.id,
      messageId: entrada.messageId,
      correlationId,
    });
    if (encolado) {
      await this.outbox
        .markCompletedByKey(
          `${OUTBOX_FLOWBOT.AVANZAR}:${executionId}:msg:${entrada.messageId}`,
        )
        .catch(() => undefined);
    }

    return { atendido: true, motivo: 'reanudada', executionId };
  }

  /**
   * Arranca un bot si alguno aplica y la conversación está libre.
   *
   * La comprobación de «conversación libre» es lo que impide que un cliente
   * impaciente que escribe tres veces seguidas se encuentre con tres bots
   * contestándole a la vez.
   */
  private async arrancarSiProcede(
    entrada: MensajeParaFlowBot,
    contactId: string | null,
  ): Promise<ResultadoIntake> {
    const viva = await this.prisma.flowBotExecution.findFirst({
      where: {
        companyId: entrada.companyId,
        conversationId: entrada.conversationId,
        status: { in: VIVAS },
      },
      select: { id: true },
    });
    if (viva) {
      // Hay una ejecución en marcha que no estaba esperando entrada: está
      // trabajando. Este mensaje no la interrumpe.
      return {
        atendido: false,
        motivo: 'ya-hay-ejecucion',
        executionId: viva.id,
      };
    }

    const { elegidos, descartados } = await this.selector.seleccionar({
      companyId: entrada.companyId,
      tipo: 'INBOUND_MESSAGE',
      conversationId: entrada.conversationId,
      contactId: entrada.contactId ?? contactId,
      leadId: entrada.leadId,
      whatsappIntegrationId: entrada.whatsappIntegrationId,
      texto: entrada.texto,
      esPrimeraConversacion: entrada.esPrimeraConversacion,
    });

    if (elegidos.length === 0) {
      if (descartados.length > 0) {
        // Se registra el porqué: «el bot no contestó» es la queja más común y
        // sin esto no hay forma de responderla.
        this.logger.debug(
          `Ningún bot atiende el mensaje: ${descartados
            .map((d) => `${d.nombre} (${d.motivo})`)
            .join('; ')}`,
        );
      }
      return { atendido: false, motivo: 'sin-bot' };
    }

    // Solo el primero. El selector ya aplicó prioridad y exclusividad; arrancar
    // varios a la vez sobre la misma conversación es precisamente lo que la
    // exclusividad existe para evitar.
    const elegido = elegidos[0];
    const correlationId = entrada.correlationId ?? entrada.messageId;

    const { executionId, creada } = await this.runner.arrancar({
      companyId: entrada.companyId,
      flowBotId: elegido.flowBotId,
      versionId: elegido.versionId,
      // El HECHO que lo dispara es este mensaje: dos entregas del mismo
      // webhook no pueden abrir dos ejecuciones.
      eventKey: entrada.messageId,
      conversationId: entrada.conversationId,
      contactId: entrada.contactId ?? contactId,
      leadId: entrada.leadId,
      whatsappIntegrationId: entrada.whatsappIntegrationId,
      triggerMessageId: entrada.messageId,
      correlationId,
      variables: {
        mensaje: { texto: entrada.texto },
        conversacion: { id: entrada.conversationId },
        ...(entrada.leadId ? { oportunidad: { id: entrada.leadId } } : {}),
      },
    });

    if (!creada) {
      // Ya existía: es un reintento del webhook. No es un fallo, y tampoco hay
      // que volver a encolar nada.
      return { atendido: true, motivo: 'arrancada', executionId };
    }

    this.logger.log(
      `FlowBot "${elegido.nombre}" arrancado [corr=${correlationId}]`,
    );
    return { atendido: true, motivo: 'arrancada', executionId };
  }
}
