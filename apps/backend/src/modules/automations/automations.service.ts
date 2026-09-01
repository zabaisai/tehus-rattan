import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MAX_LIST_ROWS } from '../../common/pagination/limites';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

import {
  AutomationRunsService,
  type PasoEjecutado,
} from './automation-runs.service';

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private whatsappService: WhatsappService,
    private runs: AutomationRunsService,
  ) {}

  async findAll(companyId: string) {
    return this.prisma.automation.findMany({
      take: MAX_LIST_ROWS,
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
    userId?: string,
  ) {
    // La version 1 se publica junto con la automatizacion, en la misma
    // transaccion: una automatizacion sin ninguna version guardada dejaria el
    // historial sin nada con que explicar sus ejecuciones.
    return this.prisma.$transaction(async (tx) => {
      const automation = await tx.automation.create({
        data: { ...data, companyId },
      });
      await tx.automationVersion.create({
        data: {
          automationId: automation.id,
          version: automation.version,
          trigger: automation.trigger,
          conditions: automation.conditions ?? undefined,
          actions: automation.actions as never,
          createdBy: userId ?? null,
        },
      });
      return automation;
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
    userId?: string,
  ) {
    const automation = await this.prisma.automation.findFirst({
      where: { id, companyId },
    });
    if (!automation)
      throw new NotFoundException('Automatización no encontrada');

    // Cambiar el nombre o el orden NO crea version: no altera lo que la
    // automatizacion hace, y versionar cada retoque cosmetico llenaria el
    // historial de ruido en el que se pierde el cambio que si importa.
    const cambiaComportamiento =
      data.trigger !== undefined ||
      data.conditions !== undefined ||
      data.actions !== undefined;

    if (!cambiaComportamiento) {
      return this.prisma.automation.update({ where: { id }, data });
    }

    return this.prisma.$transaction(async (tx) => {
      const actualizada = await tx.automation.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      });
      await tx.automationVersion.create({
        data: {
          automationId: id,
          version: actualizada.version,
          trigger: actualizada.trigger,
          conditions: actualizada.conditions ?? undefined,
          actions: actualizada.actions as never,
          createdBy: userId ?? null,
        },
      });
      return actualizada;
    });
  }

  async remove(id: string, companyId: string) {
    const automation = await this.prisma.automation.findFirst({
      where: { id, companyId },
    });
    if (!automation)
      throw new NotFoundException('Automatización no encontrada');

    return this.prisma.automation.delete({ where: { id } });
  }

  /**
   * @param messageId id del mensaje que dispara. Es la llave de idempotencia:
   *   un reintento del job NO vuelve a ejecutar las acciones, que en este
   *   dominio significa no volver a mandarle un WhatsApp al cliente.
   */
  async processMessage(
    companyId: string,
    conversationId: string,
    messageBody: string,
    contactPhone: string,
    messageId?: string,
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
      if (!triggered) continue;

      // Sin messageId no hay llave estable, asi que se ejecuta sin
      // historial: es el caso de las llamadas antiguas y de las pruebas, y
      // preferimos ejecutar sin registro a no ejecutar.
      const run = messageId
        ? await this.runs.abrir(this.prisma, {
            automationId: automation.id,
            automationVersion: automation.version,
            companyId,
            conversationId,
            triggerType: automation.trigger,
            idempotencyKey: `${messageId}:${automation.id}`,
          })
        : null;

      // `null` con messageId presente significa que ya se ejecuto: la
      // idempotencia funcionando, no un error.
      if (messageId && !run) continue;

      const pasos = await this.executeActions(
        automation.actions as any[],
        companyId,
        conversationId,
        contactPhone,
      );

      if (run) await this.runs.cerrar(this.prisma, run.id, pasos);
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

  /**
   * Ejecuta las acciones y devuelve el resultado de cada una.
   *
   * Un fallo NO detiene las siguientes: si una automatizacion manda un
   * mensaje, mueve la etapa y asigna un asesor, que falle el envio no es
   * motivo para dejar la oportunidad sin mover. Cada fallo queda registrado
   * en su paso, que es lo que permite ver despues donde se rompio.
   */
  private async executeActions(
    actions: any[],
    companyId: string,
    conversationId: string,
    contactPhone: string,
  ): Promise<PasoEjecutado[]> {
    const pasos: PasoEjecutado[] = [];

    for (const action of actions) {
      const inicio = Date.now();
      try {
        switch (action.type) {
          case 'send_message': {
            await this.whatsappService.sendFromConversation(
              companyId,
              conversationId,
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
        pasos.push({
          type: String(action?.type ?? 'desconocida'),
          ok: true,
          durationMs: Date.now() - inicio,
        });
      } catch (error) {
        // Solo el clasificador: el mensaje del proveedor puede arrastrar el
        // telefono del cliente y esto se guarda y se muestra en el historial.
        const clasificador =
          error instanceof Error ? error.name || 'Error' : 'Error';
        this.logger.warn(
          `Accion de automatizacion fallida [${String(
            action?.type,
          )}] [${clasificador}]`,
        );
        pasos.push({
          type: String(action?.type ?? 'desconocida'),
          ok: false,
          error: clasificador,
          durationMs: Date.now() - inicio,
        });
      }
    }

    return pasos;
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
