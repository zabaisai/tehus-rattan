import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

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
              companyId,
              contactPhone,
              action.message,
            );
            await this.messagesService.create({
              companyId,
              conversationId,
              body: action.message,
              direction: 'OUTBOUND',
              type: 'TEXT',
              status: 'SENT',
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
            await this.moveLeadStage(companyId, conversationId, action.stage);
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

  /**
   * TRANSICION `Conversation.stage` -> `Lead.stageId` (dual-write).
   *
   * `Conversation.stage` era un String suelto SIN relacion con PipelineStage:
   * escribirlo no movia nada en el pipeline, que es el hueco que la
   * caracterizacion dejo fijado. Ahora la accion mueve la OPORTUNIDAD, que es
   * lo que el usuario espera al configurar "cambiar de etapa".
   *
   * Durante la transicion se sigue escribiendo `Conversation.stage` para no
   * romper ningun consumidor que aun lo lea. La columna se retira en una
   * migracion posterior y separada, cuando el dual-write lleve tiempo en
   * produccion.
   *
   * La etapa se resuelve POR NOMBRE dentro del pipeline del propio lead, y
   * acotada a la empresa: una etapa de otro tenant nunca puede aplicarse.
   */
  private async moveLeadStage(
    companyId: string,
    conversationId: string,
    stageName: string,
  ): Promise<void> {
    // Dual-write: se conserva el valor antiguo mientras exista la columna.
    await this.conversationsService.update(conversationId, companyId, {
      stage: stageName,
    });

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      select: { leadId: true },
    });

    if (!conversation?.leadId) {
      // Sin oportunidad asociada no hay nada que mover. No es un error: una
      // conversacion de soporte o una consulta suelta puede no tener lead.
      this.logger.log(
        'change_stage sin oportunidad asociada: solo se registro el estado en la conversacion',
      );
      return;
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: conversation.leadId, companyId },
      select: { id: true, pipelineId: true, stageId: true },
    });
    if (!lead) return;

    const destino = await this.prisma.pipelineStage.findFirst({
      where: { pipelineId: lead.pipelineId, name: stageName },
      select: { id: true },
    });

    if (!destino) {
      this.logger.warn(
        'change_stage: la etapa indicada no existe en el pipeline de la oportunidad',
      );
      return;
    }

    if (destino.id === lead.stageId) return; // ya esta ahi: nada que hacer

    // Mover y dejar rastro, igual que hace el cambio manual de etapa.
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: { stageId: destino.id },
      });
      await tx.leadStageHistory.create({
        data: {
          leadId: lead.id,
          fromStageId: lead.stageId,
          toStageId: destino.id,
        },
      });
    });
  }
}
