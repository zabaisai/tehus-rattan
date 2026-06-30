import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappService } from './whatsapp.service';

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private whatsappService: WhatsappService,
  ) {}

  async findAll(companyId: string) {
    return this.prisma.automation.findMany({
      where: { companyId },
      orderBy: { order: 'asc' },
    });
  }

  async create(
    companyId: string,
    data: {
      name: string;
      trigger: string;
      conditions?: any;
      actions: any;
      order?: number;
    },
  ) {
    return this.prisma.automation.create({
      data: { ...data, companyId },
    });
  }

  async update(
    id: string,
    companyId: string,
    data: {
      name?: string;
      isActive?: boolean;
      trigger?: string;
      conditions?: any;
      actions?: any;
      order?: number;
    },
  ) {
    const automation = await this.prisma.automation.findFirst({
      where: { id, companyId },
    });
    if (!automation)
      throw new NotFoundException('Automatización no encontrada');

    return this.prisma.automation.update({ where: { id }, data });
  }

  async remove(id: string, companyId: string) {
    const automation = await this.prisma.automation.findFirst({
      where: { id, companyId },
    });
    if (!automation)
      throw new NotFoundException('Automatización no encontrada');

    return this.prisma.automation.delete({ where: { id } });
  }

  async processMessage(
    companyId: string,
    conversationId: string,
    messageBody: string,
    contactPhone: string,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (conversation?.isPaused) {
      this.logger.log(
        `Conversación ${conversationId} pausada, automatizaciones no ejecutadas`,
      );
      return;
    }

    const automations = await this.prisma.automation.findMany({
      where: { companyId, isActive: true },
      orderBy: { order: 'asc' },
    });

    for (const automation of automations) {
      const triggered = await this.checkTrigger(
        automation,
        messageBody,
        conversationId,
      );
      if (triggered) {
        await this.executeActions(
          automation.actions as any[],
          companyId,
          conversationId,
          contactPhone,
        );
      }
    }
  }

  private async checkTrigger(
    automation: any,
    messageBody: string,
    conversationId: string,
  ): Promise<boolean> {
    switch (automation.trigger) {
      case 'message_received': {
        return true;
      }
      case 'keyword': {
        const keywords: string[] = automation.conditions?.keywords || [];
        const lower = messageBody.toLowerCase();
        return keywords.some((kw) => lower.includes(kw.toLowerCase()));
      }
      case 'first_message': {
        const messageCount = await this.prisma.message.count({
          where: { conversationId },
        });
        return messageCount === 1;
      }
      default: {
        return false;
      }
    }
  }

  private async executeActions(
    actions: any[],
    companyId: string,
    conversationId: string,
    contactPhone: string,
  ) {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'send_message': {
            await this.whatsappService.sendMessage(
              contactPhone,
              action.message,
            );
            await this.messagesService.create({
              conversationId,
              body: action.message,
              direction: 'OUTBOUND',
              type: 'TEXT',
              status: 'sent',
            });
            break;
          }
          case 'assign_agent': {
            await this.conversationsService.update(conversationId, companyId, {
              assignedTo: action.agentId,
            });
            break;
          }
          case 'change_stage': {
            await this.conversationsService.update(conversationId, companyId, {
              stage: action.stage,
            });
            break;
          }
          case 'close_conversation': {
            await this.conversationsService.update(conversationId, companyId, {
              status: 'CLOSED',
            });
            break;
          }
        }
      } catch (error) {
        this.logger.error(`Error ejecutando acción ${action.type}`, error);
      }
    }
  }
}
