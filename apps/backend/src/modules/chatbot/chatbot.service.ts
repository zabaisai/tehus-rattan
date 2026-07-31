import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MessagesService } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignmentService } from '../assignment/assignment.service';
import {
  elegirOpcion,
  interpolar,
  MAXIMO_PASOS,
  type FlujoChatbot,
  type NodoChatbot,
} from './chatbot.nodes';

/** Qué hizo el chatbot con un mensaje entrante. */
export interface ResultadoChatbot {
  /** `true` si el bot respondió: entonces las automatizaciones NO deben actuar. */
  atendido: boolean;
  motivo:
    | 'sin-flujo'
    | 'conversacion-pausada'
    | 'respondido'
    | 'entregado-a-humano'
    | 'finalizado'
    | 'error';
  sessionId?: string;
}

/**
 * Motor del chatbot v1.
 *
 * QUIÉN MANDA CUANDO HAY CHATBOT Y AUTOMATIZACIONES A LA VEZ
 * El chatbot va primero y, si responde, las automatizaciones se saltan. Sin
 * esa regla el cliente recibiría dos mensajes por cada uno que envía —el del
 * bot y el de la automatización— que es exactamente lo que hace que la gente
 * deje de contestar. Es una única estrategia y está escrita en un solo sitio:
 * `runInboundEffects`.
 *
 * PAUSAR LA CONVERSACIÓN LO DESACTIVA. Es el interruptor que ya usa el asesor
 * cuando toma el control, y se respeta aquí: si está pausada, el bot no
 * escribe ni avanza la sesión.
 *
 * LAS SESIONES APUNTAN A UNA VERSIÓN PUBLICADA, no al flujo. Quien empezó con
 * la versión 3 la termina con la 3 aunque se publique la 4 a mitad: cambiarle
 * el flujo bajo los pies a alguien que está respondiendo preguntas lo deja en
 * un nodo que ya no existe.
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly assignment: AssignmentService,
  ) {}

  async handleInbound(input: {
    companyId: string;
    conversationId: string;
    contactPhone: string;
    text: string;
  }): Promise<ResultadoChatbot> {
    try {
      const conversacion = await this.prisma.conversation.findFirst({
        where: { id: input.conversationId, companyId: input.companyId },
        select: { isPaused: true, assignedTo: true },
      });

      // Pausada = alguien tomó el control a mano. El bot calla.
      if (!conversacion || conversacion.isPaused) {
        return { atendido: false, motivo: 'conversacion-pausada' };
      }

      const sesion = await this.prisma.chatbotSession.findFirst({
        where: { conversationId: input.conversationId, status: 'ACTIVE' },
        include: { flowVersion: { select: { id: true, nodes: true } } },
      });

      if (sesion) return this.avanzar(input, sesion);
      return this.iniciar(input);
    } catch (error) {
      // Un fallo del bot no puede impedir que el mensaje se procese: se
      // registra y se devuelve "no atendido" para que el resto del flujo
      // —automatizaciones, avisos— siga su curso.
      this.logger.warn(
        `Chatbot no pudo atender el mensaje [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
      return { atendido: false, motivo: 'error' };
    }
  }

  // ── inicio ──────────────────────────────────────────────────

  private async iniciar(input: {
    companyId: string;
    conversationId: string;
    contactPhone: string;
    text: string;
  }): Promise<ResultadoChatbot> {
    const flujos = await this.prisma.chatbotFlow.findMany({
      where: {
        companyId: input.companyId,
        isActive: true,
        publishedVersion: { not: null },
      },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });

    const texto = input.text.trim().toLowerCase();
    // Un flujo con palabras clave gana al genérico: si alguien configuró
    // "precio", quiere ese flujo para esa palabra, no el saludo de siempre.
    const conPalabras = flujos.find((f) =>
      f.triggerKeywords.some((k) => texto.includes(k.trim().toLowerCase())),
    );
    const generico = flujos.find((f) => f.triggerKeywords.length === 0);
    const flujo = conPalabras ?? generico;

    if (!flujo?.versions[0]) return { atendido: false, motivo: 'sin-flujo' };

    const definicion = flujo.versions[0].nodes as unknown as FlujoChatbot;
    const inicial = this.buscarNodo(definicion, definicion.start);
    if (!inicial) return { atendido: false, motivo: 'sin-flujo' };

    let sesion;
    try {
      sesion = await this.prisma.chatbotSession.create({
        data: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          flowId: flujo.id,
          flowVersionId: flujo.versions[0].id,
          currentNode: inicial.id,
          context: {},
        },
      });
    } catch (error) {
      // El índice parcial rechaza la segunda sesión activa. Dos mensajes
      // simultáneos del mismo contacto llegan aquí a la vez; el que pierde
      // simplemente no responde, en vez de duplicarle el saludo al cliente.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { atendido: false, motivo: 'sin-flujo' };
      }
      throw error;
    }

    return this.ejecutarDesde(input, sesion.id, definicion, inicial, {});
  }

  // ── avance ──────────────────────────────────────────────────

  private async avanzar(
    input: {
      companyId: string;
      conversationId: string;
      contactPhone: string;
      text: string;
    },
    sesion: {
      id: string;
      currentNode: string;
      context: Prisma.JsonValue;
      steps: number;
      flowVersion: { nodes: Prisma.JsonValue };
    },
  ): Promise<ResultadoChatbot> {
    const definicion = sesion.flowVersion.nodes as unknown as FlujoChatbot;
    const actual = this.buscarNodo(definicion, sesion.currentNode);
    const contexto = (sesion.context ?? {}) as Record<string, unknown>;

    // El nodo desapareció: solo puede pasar si alguien manipuló la versión.
    // Se entrega a una persona en vez de dejar al cliente sin respuesta.
    if (!actual) return this.entregar(input, sesion.id, contexto);

    if (actual.type === 'question' && actual.saveAs) {
      contexto[actual.saveAs] = input.text.trim();
    }

    let siguienteId: string | undefined;
    if (actual.type === 'menu') {
      const opcion = elegirOpcion(actual, input.text);
      if (!opcion) {
        // No se entiende la respuesta: se repite el menú en vez de avanzar a
        // ciegas. Repetirlo es molesto; adivinar es peor.
        await this.enviar(input, this.textoDe(actual, contexto));
        return { atendido: true, motivo: 'respondido', sessionId: sesion.id };
      }
      siguienteId = opcion.next;
    } else {
      siguienteId = actual.next;
    }

    const siguiente = siguienteId
      ? this.buscarNodo(definicion, siguienteId)
      : undefined;
    if (!siguiente) return this.finalizar(input, sesion.id, contexto);

    return this.ejecutarDesde(
      input,
      sesion.id,
      definicion,
      siguiente,
      contexto,
      sesion.steps,
    );
  }

  /**
   * Recorre nodos hasta encontrar uno que espere respuesta.
   *
   * Los `message` encadenados se envían seguidos: obligar al cliente a
   * contestar "ok" entre dos frases del bot es una fricción que nadie pidió.
   */
  private async ejecutarDesde(
    input: {
      companyId: string;
      conversationId: string;
      contactPhone: string;
      text: string;
    },
    sessionId: string,
    definicion: FlujoChatbot,
    desde: NodoChatbot,
    contexto: Record<string, unknown>,
    pasosPrevios = 0,
  ): Promise<ResultadoChatbot> {
    let nodo: NodoChatbot | undefined = desde;
    let pasos = pasosPrevios;

    while (nodo) {
      pasos += 1;
      if (pasos > MAXIMO_PASOS) {
        // Bucle. Se entrega a una persona: el cliente está a mitad de algo y
        // merece que alguien lo recoja, no que el bot enmudezca.
        this.logger.warn('Flujo de chatbot detenido por exceso de pasos');
        return this.entregar(input, sessionId, contexto);
      }

      if (nodo.type === 'handoff') {
        if (nodo.text) await this.enviar(input, this.textoDe(nodo, contexto));
        return this.entregar(input, sessionId, contexto);
      }

      if (nodo.type === 'end') {
        if (nodo.text) await this.enviar(input, this.textoDe(nodo, contexto));
        return this.finalizar(input, sessionId, contexto);
      }

      await this.enviar(input, this.textoDe(nodo, contexto));

      // `question` y `menu` esperan al cliente; `message` sigue de largo.
      if (nodo.type !== 'message') {
        await this.prisma.chatbotSession.update({
          where: { id: sessionId },
          data: {
            currentNode: nodo.id,
            context: contexto as Prisma.InputJsonValue,
            steps: pasos,
            lastInteractionAt: new Date(),
          },
        });
        return { atendido: true, motivo: 'respondido', sessionId };
      }

      nodo = nodo.next ? this.buscarNodo(definicion, nodo.next) : undefined;
    }

    return this.finalizar(input, sessionId, contexto);
  }

  // ── cierres ─────────────────────────────────────────────────

  /** Pasa la conversación a una persona y para el bot. */
  private async entregar(
    input: { companyId: string; conversationId: string },
    sessionId: string,
    contexto: Record<string, unknown>,
  ): Promise<ResultadoChatbot> {
    const asesor = await this.assignment.pickNextAgent(input.companyId);

    // LO CRÍTICO PRIMERO Y SIN EL ASESOR: cerrar la sesión y pausar la
    // conversación. Si esto fuera en la misma transacción que la asignación,
    // un asesor que ya no existe —borrado entre la elección y el guardado—
    // haría fallar la transacción entera y el cliente se quedaría atrapado
    // con el bot, que es el peor resultado posible de una petición de ayuda.
    await this.prisma.$transaction(async (tx) => {
      await tx.chatbotSession.update({
        where: { id: sessionId },
        data: {
          status: 'HANDED_OVER',
          context: contexto as Prisma.InputJsonValue,
          endedAt: new Date(),
        },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: {
          // Pausar es lo que impide que el bot vuelva a engancharse en el
          // siguiente mensaje. La entrega tiene que ser definitiva.
          isPaused: true,
        },
      });
    });

    // La asignación va aparte y puede fallar sin arrastrar nada: la
    // conversación ya está en manos humanas, aunque sea en la bandeja común.
    let asignado = false;
    if (asesor) {
      asignado = await this.prisma.conversation
        .update({
          where: { id: input.conversationId },
          data: { assignedTo: asesor },
        })
        .then(() => true)
        .catch(() => {
          this.logger.warn(
            'No se pudo asignar el asesor elegido al entregar la conversación',
          );
          return false;
        });
    }

    if (asesor && asignado) {
      await this.notifications.emit({
        companyId: input.companyId,
        recipientUserId: asesor,
        type: 'CONVERSATION_ASSIGNED',
        title: 'El chatbot te pasó una conversación',
        bodyPreview: 'El cliente pidió hablar con una persona.',
        entityType: 'Conversation',
        entityId: input.conversationId,
        actionUrl: '/dashboard/conversations',
        dedupeKey: `CHATBOT_HANDOFF:${sessionId}`,
      });
    } else {
      await this.assignment.warnNobodyAvailable(input.companyId);
    }

    return {
      atendido: true,
      motivo: 'entregado-a-humano',
      sessionId,
    };
  }

  private async finalizar(
    input: { conversationId: string },
    sessionId: string,
    contexto: Record<string, unknown>,
  ): Promise<ResultadoChatbot> {
    await this.prisma.chatbotSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        context: contexto as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });
    void input;
    return { atendido: true, motivo: 'finalizado', sessionId };
  }

  // ── auxiliares ──────────────────────────────────────────────

  private buscarNodo(
    definicion: FlujoChatbot,
    id: string,
  ): NodoChatbot | undefined {
    return definicion?.nodes?.find((n) => n.id === id);
  }

  private textoDe(nodo: NodoChatbot, contexto: Record<string, unknown>): string {
    const base = interpolar(nodo.text ?? '', contexto);
    if (nodo.type !== 'menu') return base;

    // Las opciones se numeran al enviarlas: por WhatsApp no hay botones en
    // texto plano, y sin numerar el cliente no sabe qué escribir.
    const opciones = (nodo.options ?? [])
      .map((o, i) => `${i + 1}. ${o.label}`)
      .join('\n');
    return opciones ? `${base}\n\n${opciones}` : base;
  }

  /** Envía por WhatsApp y deja el mensaje en el hilo, como cualquier saliente. */
  private async enviar(
    input: { companyId: string; conversationId: string; contactPhone: string },
    texto: string,
  ): Promise<void> {
    if (!texto.trim()) return;

    const wamid = await this.whatsapp.sendMessage(
      input.companyId,
      input.contactPhone,
      texto,
    );

    await this.messages.create({
      companyId: input.companyId,
      conversationId: input.conversationId,
      body: texto,
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: wamid ? 'SENT' : 'FAILED',
      ...(wamid ? { wamid } : {}),
    });
  }
}
