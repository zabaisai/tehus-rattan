import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { ContactsService } from '../contacts/contacts.service';
import { AutomationsService } from '../automations/automations.service';
import { WhatsAppIntegrationService } from '../whatsapp-integration/whatsapp-integration.service';
import { NotificationsService } from '../notifications/notifications.service';
import { maskPhone } from '../../common/logging/redact';
import { InboundQueueService } from '../../common/queue/inbound-queue.service';
import { LeadIntakeService } from '../leads/lead-intake.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { HistorySyncService } from '../whatsapp-history/history-sync.service';
import {
  OutboxService,
  OUTBOX_TYPES,
} from '../../common/outbox/outbox.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private messagesService: MessagesService,
    private contactsService: ContactsService,
    private automationsService: AutomationsService,
    private whatsappIntegrationService: WhatsAppIntegrationService,
    private notifications: NotificationsService,
    private inboundQueue: InboundQueueService,
    private outbox: OutboxService,
    private leadIntake: LeadIntakeService,
    private chatbot: ChatbotService,
    private historySync: HistorySyncService,
  ) {}

  /** ¿Este cambio trae historial de coexistencia? */
  private tieneHistorial(value: any): boolean {
    return (
      Array.isArray(value?.history) ||
      Array.isArray(value?.history?.threads) ||
      Array.isArray(value?.threads)
    );
  }

  // Walks the whole Meta payload — every entry, every change, every message —
  // instead of only entry[0]/changes[0]/messages[0]. Payloads that carry no
  // messages (e.g. delivery/read `statuses`, or unrelated fields) are skipped
  // safely rather than crashing. Each message is deduped and processed
  // independently so one failure never drops the rest of the batch.
  async processWebhook(body: any): Promise<void> {
    const entries = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const change of changes) {
        const value = change?.value;
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

        // Avances de entrega (sent/delivered/read/failed). Se procesan aunque
        // el payload no traiga mensajes: Meta los envía por separado. No
        // requieren resolver la empresa, porque el `wamid` ya identifica de
        // forma única el mensaje y su conversación.
        if (statuses.length > 0) {
          await this.processStatuses(statuses);
        }

        // Sincronizacion de historial de COEXISTENCIA. Meta la envia una sola
        // vez al conectar un numero que venia usandose en la app de WhatsApp
        // Business. Va por un camino aparte del de los mensajes en vivo, y
        // ESO ES LO IMPORTANTE: lo importado no dispara automatizaciones, ni
        // chatbot, ni crea oportunidades. Un mensaje de hace seis meses que
        // dispare una automatizacion manda un WhatsApp real a un cliente por
        // una conversacion que termino hace medio ano.
        if (this.tieneHistorial(value)) {
          const integracionHistorial =
            await this.whatsappIntegrationService.findConnectedByPhoneNumberId(
              value?.metadata?.phone_number_id,
            );
          if (integracionHistorial) {
            await this.historySync
              .procesarHistorial(integracionHistorial.companyId, value)
              .catch((error: unknown) => {
                // Un fallo importando historial no puede tumbar el webhook:
                // por el mismo camino llegan los mensajes en vivo.
                this.logger.warn(
                  `Fallo la sincronizacion de historial [${
                    error instanceof Error ? error.name : 'Error'
                  }]`,
                );
              });
          }
          continue;
        }

        if (messages.length === 0) continue;

        const phoneNumberId = value?.metadata?.phone_number_id;
        const integration =
          await this.whatsappIntegrationService.findConnectedByPhoneNumberId(
            phoneNumberId,
          );

        if (!integration) {
          this.logger.warn(
            `No se encontró integración WhatsApp conectada para phoneNumberId: ${phoneNumberId}`,
          );
          continue;
        }

        const companyId = integration.companyId;
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

        for (const message of messages) {
          try {
            await this.processSingleMessage(
              companyId,
              message,
              contacts,
              integration.id,
            );
          } catch (error) {
            // Isolate per-message failures. The message was not persisted (so
            // it is not deduped), leaving Meta's retry free to reprocess it.
            this.logger.error(
              `Error procesando mensaje ${message?.id ?? '(sin id)'}`,
              error as Error,
            );
          }
        }
      }
    }
  }

  // Traduce los `statuses` de Meta al ciclo de entrega del CRM. Cada uno se
  // aísla: un wamid desconocido (por ejemplo, un mensaje enviado antes de
  // conectar el CRM) no debe impedir que se apliquen los demás.
  private async processStatuses(statuses: any[]): Promise<void> {
    const mapa: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };

    for (const status of statuses) {
      try {
        const nuevo = mapa[String(status?.status ?? '').toLowerCase()];
        if (!nuevo || !status?.id) continue;

        // `timestamp` de Meta viene en segundos como texto.
        const segundos = Number(status.timestamp);
        const occurredAt = Number.isFinite(segundos)
          ? new Date(segundos * 1000)
          : undefined;

        // Del error solo se conserva el clasificador y el título, nunca el
        // payload crudo: puede incluir datos del destinatario.
        const primerError = Array.isArray(status.errors)
          ? status.errors[0]
          : undefined;

        const resultado = await this.messagesService.applyDeliveryStatus({
          wamid: String(status.id),
          status: nuevo,
          occurredAt,
          errorCode:
            primerError?.code !== undefined ? String(primerError.code) : null,
          errorMessage: primerError?.title
            ? String(primerError.title).slice(0, 200)
            : null,
        });

        if (resultado === 'unknown') {
          this.logger.log(
            `Estado ${nuevo} recibido para un mensaje que el CRM no tiene almacenado`,
          );
        }
      } catch (error) {
        this.logger.error('Error aplicando estado de entrega', error as Error);
      }
    }
  }

  // Tipos que Meta entrega y que el CRM sabe representar. `reaction` y
  // `system` se omiten a propósito: no son mensajes de la conversación.
  private readonly TIPOS_SOPORTADOS: Record<string, string> = {
    text: 'TEXT',
    image: 'IMAGE',
    audio: 'AUDIO',
    video: 'VIDEO',
    document: 'DOCUMENT',
    sticker: 'STICKER',
    location: 'LOCATION',
    contacts: 'CONTACTS',
    interactive: 'INTERACTIVE',
  };

  // Un interactivo lleva la respuesta del usuario en el título del botón o de
  // la fila elegida. Se extrae ese texto para que el hilo sea legible sin
  // tener que interpretar el JSON.
  private textoDeInteractivo(interactive: any): string {
    return String(
      interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? '',
    );
  }

  private async processSingleMessage(
    companyId: string,
    message: any,
    contacts: any[],
    whatsappIntegrationId?: string,
  ): Promise<void> {
    if (!message?.id || !message?.from) return;

    const tipoMeta = String(message.type ?? 'text').toLowerCase();
    const tipo = this.TIPOS_SOPORTADOS[tipoMeta] ?? 'UNSUPPORTED';

    const duplicate = await this.messagesService.findByWamid(message.id);
    if (duplicate) {
      this.logger.warn(`Mensaje duplicado: ${message.id}`);
      return;
    }

    // Prefer the contact whose wa_id matches this message's sender (correct
    // when a batch carries several senders); fall back to the first contact
    // for the common single-sender payload shape.
    const matchedContact =
      contacts.find((c) => c?.wa_id === message.from) ?? contacts[0];
    const profileName = matchedContact?.profile?.name;

    let contactRecord = await this.prisma.contact.findFirst({
      where: { phone: message.from, companyId },
    });

    if (!contactRecord) {
      contactRecord = await this.contactsService.create(companyId, {
        phone: message.from,
        name: profileName,
      });
    }

    const conversation = await this.conversationsService.findOrCreate(
      companyId,
      contactRecord.id,
      whatsappIntegrationId,
    );

    // El adjunto real vive bajo la clave del propio tipo (image, audio, …).
    const adjunto = message[tipoMeta] ?? {};
    const caption: string | undefined = adjunto?.caption || undefined;

    // `body` es lo que se muestra en el hilo. Para un medio, el pie de foto;
    // si no lo hay, queda vacío y la interfaz decide cómo representarlo. NO se
    // inventa un texto tipo "[imagen]": eso es decisión de presentación.
    const text =
      tipoMeta === 'text'
        ? message.text?.body || ''
        : tipoMeta === 'interactive'
          ? this.textoDeInteractivo(message.interactive)
          : caption || '';

    const persistido = await this.messagesService.create(
      {
        companyId,
        conversationId: conversation.id,
        wamid: message.id,
        body: text,
        direction: 'INBOUND',
        type: tipo as never,
        status: 'RECEIVED',
        // El binario NO se descarga aquí: el webhook debe responder rápido y
        // `mediaId` caduca en Meta. Se guarda la referencia y la descarga la
        // hará un job aparte, que rellenará `mediaUrl`.
        ...(adjunto?.id ? { mediaId: String(adjunto.id) } : {}),
        ...(adjunto?.mime_type
          ? { mediaMimeType: String(adjunto.mime_type) }
          : {}),
        ...(adjunto?.filename
          ? { mediaFileName: String(adjunto.filename) }
          : {}),
        ...(caption ? { caption } : {}),
        ...(tipoMeta === 'location' && message.location
          ? { location: message.location }
          : {}),
        ...(tipoMeta === 'contacts' && message.contacts
          ? { contacts: message.contacts }
          : {}),
        ...(tipoMeta === 'interactive' && message.interactive
          ? { interactive: message.interactive }
          : {}),
        ...(message.context?.id
          ? { replyToWamid: String(message.context.id) }
          : {}),
      },
      // Outbox EN LA MISMA TRANSACCION: o se guardan mensaje y evento, o no
      // se guarda ninguno. Sin esto, morir entre el commit y el enqueue
      // dejaria un mensaje cuyos efectos no ocurririan nunca, y nadie se
      // enteraria porque el webhook ya respondio 200 y Meta no reintenta.
      async (tx, mensaje) => {
        await this.outbox.record(tx, {
          type: OUTBOX_TYPES.INBOUND_MESSAGE,
          companyId,
          idempotencyKey: mensaje.id,
          payload: {
            companyId,
            conversationId: conversation.id,
            messageId: mensaje.id,
            contactPhone: message.from,
            body: text,
          },
        });
      },
    );

    // Los efectos van a la cola: Meta exige un ack rapido y reintenta si el
    // webhook tarda, asi que ejecutar automatizaciones y notificaciones aqui
    // dentro es justamente lo que provoca reintentos y mensajes duplicados
    // cuando una de esas acciones se ralentiza.
    //
    // Si la cola no esta disponible se ejecuta en linea, igual que antes: un
    // fallo de Redis degrada la latencia, nunca deja un mensaje sin procesar.
    // El evento de outbox ya quedó escrito en la MISMA transacción que el
    // mensaje (ver la llamada a messagesService.create de arriba), así que a
    // partir de aquí los efectos están garantizados aunque este proceso muera
    // ahora mismo: el dispatcher los recogerá.
    //
    // Se intenta encolar de inmediato solo para no esperar al siguiente pase
    // del dispatcher. Si falla, no se hace nada: el evento sigue PENDING.
    const encolado = await this.inboundQueue.enqueueInboundMessage({
      companyId,
      conversationId: conversation.id,
      messageId: persistido.id,
      contactPhone: message.from,
      body: text,
    });

    if (encolado) {
      // Ya está en la cola: se marca completado para que el dispatcher no lo
      // vuelva a empujar. La idempotencia del jobId lo protegería igualmente,
      // pero marcarlo evita trabajo inútil.
      await this.outbox
        .markCompletedByKey(persistido.id)
        .catch(() => undefined);
    }

    this.logger.log(`Mensaje procesado de ${maskPhone(message.from)}`);
  }

  /**
   * Efectos de un mensaje entrante: oportunidad, automatizaciones y aviso.
   *
   * Publico para que el procesador de la cola lo reutilice: encolado y en
   * linea deben ejecutar EXACTAMENTE lo mismo, o el comportamiento cambiaria
   * segun si Redis esta levantado.
   *
   * El ORDEN importa. La oportunidad va primero porque es la que dispara el
   * reparto: si el asesor se resolviera despues, el aviso saldria sin
   * destinatario y el mensaje se quedaria sin nadie mirandolo hasta que
   * alguien entrara a la bandeja comun.
   */
  async runInboundEffects(
    companyId: string,
    conversationId: string,
    text: string,
    contactPhone: string,
    assignedTo: string | null,
    /**
     * Llave de idempotencia de las automatizaciones. Opcional para no romper
     * a los llamadores antiguos, pero sin ella una reejecucion del job vuelve
     * a lanzar las acciones — que aqui significa mandar otra vez el mensaje.
     */
    messageId?: string,
  ): Promise<void> {
    // Entrada al tablero. Acotada por companyId aunque el trabajo venga de
    // nuestra propia cola: no se confia en su contenido para saltarse el
    // aislamiento.
    const conversacion = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      select: {
        contactId: true,
        contact: { select: { name: true } },
      },
    });

    let asignadoPorReparto: string | null = null;

    if (conversacion) {
      // Best-effort: si la entrada al tablero falla, el mensaje ya esta
      // guardado y la conversacion se atiende igual. Preferimos un tablero
      // incompleto a un mensaje perdido.
      try {
        const intake = await this.leadIntake.ensureLeadForConversation({
          companyId,
          contactId: conversacion.contactId,
          conversationId,
          contactName: conversacion.contact?.name,
        });
        asignadoPorReparto = intake.assignedTo;
      } catch (error) {
        this.logger.warn(
          `No se pudo crear la oportunidad del mensaje entrante [${
            error instanceof Error ? error.name : 'Error'
          }]`,
        );
      }
    }

    // El id del mensaje viaja como llave de idempotencia: si el job se
    // reintenta, las automatizaciones NO se vuelven a ejecutar y el cliente no
    // recibe el mismo WhatsApp dos veces.
    // EL CHATBOT VA PRIMERO, Y SI RESPONDE LAS AUTOMATIZACIONES SE SALTAN.
    //
    // Es la estrategia unica frente al doble efecto, y vive aqui, en un solo
    // sitio. Sin ella el cliente recibiria DOS mensajes por cada uno que
    // envia -el del bot y el de la automatizacion- que es exactamente lo que
    // hace que la gente deje de contestar. El bot ya respeta la pausa de la
    // conversacion, asi que un asesor que toma el control silencia a ambos.
    // El servicio ya captura sus propios fallos, pero se envuelve igual: si
    // algun dia deja de hacerlo, un bot roto no puede impedir que el mensaje
    // se procese. Mismo criterio que la entrada al tablero: preferimos una
    // conversacion sin respuesta automatica a un mensaje sin procesar.
    const respuestaBot = await this.chatbot
      .handleInbound({ companyId, conversationId, contactPhone, text })
      .catch((error: unknown) => {
        this.logger.warn(
          `El chatbot fallo al atender el mensaje [${
            error instanceof Error ? error.name : 'Error'
          }]`,
        );
        return { atendido: false as const, motivo: 'error' as const };
      });

    if (respuestaBot.atendido) {
      // Tambien se salta el aviso al asesor, y es deliberado: mientras el bot
      // conversa, un "nuevo mensaje" por cada intercambio seria ruido puro. En
      // el momento en que el bot entrega la conversacion, el asesor recibe SU
      // aviso -CONVERSATION_ASSIGNED- desde el propio chatbot.
      //
      // La oportunidad ya se creo mas arriba: entrar al tablero no depende de
      // quien conteste.
      this.logger.log(
        `Mensaje atendido por el chatbot (${respuestaBot.motivo})`,
      );
      return;
    }

    await this.automationsService.processMessage(
      companyId,
      conversationId,
      text,
      contactPhone,
      messageId,
    );

    // Aviso al asesor asignado. Best-effort (nunca rompe el procesamiento),
    // con una vista previa corta y saneada —nunca el cuerpo completo ni el
    // telefono entero— y deduplicado por conversacion en cubos de 5 minutos
    // para que una rafaga colapse en un solo aviso.
    // Si la conversacion ya tenia asesor, manda ese: pudo tomarla alguien a
    // mano y el reparto no debe pisar esa decision.
    const destinatario = assignedTo ?? asignadoPorReparto;

    if (destinatario) {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 60);
      const bucket = Math.floor(Date.now() / 300_000);
      void this.notifications.emit({
        companyId,
        recipientUserId: destinatario,
        type: 'NEW_INBOUND_MESSAGE',
        title: 'Nuevo mensaje de WhatsApp',
        bodyPreview: preview || undefined,
        entityType: 'Conversation',
        entityId: conversationId,
        actionUrl: `/dashboard/conversations`,
        dedupeKey: `NEW_INBOUND_MESSAGE:${conversationId}:${bucket}`,
      });
    }
  }
}
