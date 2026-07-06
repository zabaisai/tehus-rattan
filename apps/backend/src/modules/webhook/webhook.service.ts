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

  async processWebhook(body: any): Promise<void> {
    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages) return;

      const message = value.messages[0];
      const contact = value.contacts?.[0];
      const phoneNumberId = value.metadata?.phone_number_id;

      const integration =
        await this.whatsappIntegrationService.findConnectedByPhoneNumberId(
          phoneNumberId,
        );

      if (!integration) {
        this.logger.warn(
          `No se encontró integración WhatsApp conectada para phoneNumberId: ${phoneNumberId}`,
        );
        return;
      }

      const companyId = integration.companyId;

      const duplicate = await this.messagesService.findByWamid(message.id);
      if (duplicate) {
        this.logger.warn(`Mensaje duplicado: ${message.id}`);
        return;
      }

      let contactRecord = await this.prisma.contact.findFirst({
        where: { phone: message.from, companyId },
      });

      if (!contactRecord) {
        contactRecord = await this.contactsService.create(companyId, {
          phone: message.from,
          name: contact?.profile?.name,
        });
      }

      const conversation = await this.conversationsService.findOrCreate(
        companyId,
        contactRecord.id,
      );

      await this.messagesService.create({
        companyId,
        conversationId: conversation.id,
        wamid: message.id,
        body: message.text?.body || '',
        direction: 'INBOUND',
        type: 'TEXT',
        status: 'RECEIVED',
      });

      await this.automationsService.processMessage(
        companyId,
        conversation.id,
        message.text?.body || '',
        message.from,
      );

      this.logger.log(`Mensaje procesado de ${message.from}`);
    } catch (error) {
      this.logger.error('Error procesando webhook', error);
    }
  }
}
