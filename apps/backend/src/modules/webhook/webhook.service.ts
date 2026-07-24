import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { ContactsService } from '../contacts/contacts.service';
import { AutomationsService } from '../automations/automations.service';
import { WhatsAppIntegrationService } from '../whatsapp-integration/whatsapp-integration.service';

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
  ) {}

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

        // No inbound messages here (status updates, template events, etc.) —
        // nothing to persist yet. Delivery/read statuses are a documented
        // pending item; skipping them is intentional, not an error.
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
            await this.processSingleMessage(companyId, message, contacts);
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

  private async processSingleMessage(
    companyId: string,
    message: any,
    contacts: any[],
  ): Promise<void> {
    if (!message?.id || !message?.from) return;

    // Only text is persisted today. Other types (image/audio/video/document/
    // sticker/location/interactive/...) are acknowledged and skipped — a
    // documented pending item, not a failure.
    if (message.type && message.type !== 'text') {
      this.logger.log(
        `Tipo de mensaje no soportado aún, ignorado: ${message.type}`,
      );
      return;
    }

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
    );

    const text = message.text?.body || '';

    await this.messagesService.create({
      companyId,
      conversationId: conversation.id,
      wamid: message.id,
      body: text,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
    });

    await this.automationsService.processMessage(
      companyId,
      conversation.id,
      text,
      message.from,
    );

    this.logger.log(`Mensaje procesado de ${message.from}`);
  }
}
