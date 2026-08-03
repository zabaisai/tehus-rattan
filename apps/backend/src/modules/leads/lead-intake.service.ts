import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEmitter } from '../../common/realtime/realtime.emitter';
import { AssignmentService } from '../assignment/assignment.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeadSettingsService } from './lead-settings.service';

export interface ResultadoIntake {
  leadId: string | null;
  /** `true` solo si esta llamada creó la oportunidad. */
  creado: boolean;
  /** Asesor asignado por el reparto, si lo hubo. */
  assignedTo: string | null;
  /** Por qué no se creó nada, cuando no se creó. */
  motivo?:
    | 'sin-pipeline'
    | 'sin-etapas'
    | 'ya-existia'
    | 'desactivado'
    | 'sin-etapa-inicial';
}

/**
 * Entrada comercial: convertir una conversación entrante en oportunidad.
 *
 * ESTO ES LO QUE FALTABA. Hasta ahora `lead.create` solo se invocaba desde el
 * endpoint manual, y el webhook nunca lo llamaba: por eso WhatsApp funcionaba
 * —los mensajes se guardaban, la conversación existía— pero el tablero seguía
 * vacío y parecía que el CRM no hacía nada.
 *
 * LA REGLA (decisión cerrada nº 2)
 *   Un mensaje entrante crea oportunidad SOLO si ese contacto no tiene ya una
 *   abierta en el pipeline aplicable. Si la tiene, se reutiliza. Si todas sus
 *   oportunidades están cerradas (ganada o perdida), un contacto posterior sí
 *   puede abrir una nueva: volver a escribir meses después es un negocio
 *   nuevo, no una reapertura del anterior.
 *
 * IDEMPOTENCIA
 *   Dos mensajes del mismo contacto pueden llegar a la vez y ser procesados
 *   por dos trabajadores distintos. Un simple "busca y si no existe crea"
 *   crearía dos oportunidades: ambos leen "no existe" antes de que ninguno
 *   escriba. Se serializa con un bloqueo consultivo de PostgreSQL por
 *   (empresa, contacto) dentro de la transacción; el segundo espera, vuelve a
 *   mirar y encuentra la que creó el primero.
 *
 *   Se eligió el bloqueo consultivo y no un índice único parcial porque el
 *   índice también prohibiría al usuario crear a mano dos oportunidades
 *   abiertas del mismo contacto, que es una operación legítima y que hoy ya
 *   permite el producto. La regla es de la entrada automática, no del modelo.
 */
@Injectable()
export class LeadIntakeService {
  private readonly logger = new Logger(LeadIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: AssignmentService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeEmitter,
    private readonly settings: LeadSettingsService,
  ) {}

  async ensureLeadForConversation(input: {
    companyId: string;
    contactId: string;
    conversationId: string;
    /** Nombre del contacto, para titular la oportunidad. */
    contactName?: string | null;
  }): Promise<ResultadoIntake> {
    const { companyId, contactId, conversationId } = input;

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Serializa a los concurrentes del MISMO contacto. Es de transacción:
      // se libera solo al terminar, con o sin éxito, así que un fallo no deja
      // el bloqueo colgado. No bloquea a otros contactos ni a otras empresas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${contactId}`}))`;

      // La empresa decide dónde entra y con qué reglas. Sin configuración se
      // aplican los valores por defecto, que son los que el producto ya venía
      // usando: nadie tiene que configurar nada para que siga funcionando.
      const config = await this.settings.resolver(companyId, tx);

      if (!config.autoCreateLead) {
        // Apagar la creación automática deja el CRM como una bandeja. Es una
        // decisión legítima y no un fallo.
        return { leadId: null, creado: false, motivo: 'desactivado' as const };
      }

      // Sin sitio donde colocarla no se inventa uno. No es un error del
      // mensaje: la conversación ya está guardada y se atiende igual.
      if (!config.pipelineId) {
        return { leadId: null, creado: false, motivo: 'sin-pipeline' as const };
      }
      if (!config.stageId) {
        return {
          leadId: null,
          creado: false,
          motivo: 'sin-etapa-inicial' as const,
        };
      }
      const pipeline = { id: config.pipelineId };
      const primeraEtapa = { id: config.stageId };

      // Reutilizar la oportunidad abierta es configurable: hay negocios donde
      // cada conversación es una venta distinta.
      const abierta = config.reuseOpenLead
        ? await tx.lead.findFirst({
            where: {
              companyId,
              contactId,
              pipelineId: pipeline.id,
              status: 'OPEN',
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, assignedTo: true },
          })
        : null;

      if (abierta) {
        // Se reutiliza y se ata la conversación a ella, que es justo el
        // vínculo que permite ver el hilo desde la oportunidad.
        await tx.conversation.update({
          where: { id: conversationId },
          data: { leadId: abierta.id },
        });
        return {
          leadId: abierta.id,
          creado: false,
          assignedTo: abierta.assignedTo,
          motivo: 'ya-existia' as const,
        };
      }

      // Reparto: la oportunidad y la conversación van al MISMO asesor. Que la
      // ficha esté en una bandeja y el chat en otra es la forma más rápida de
      // que nadie responda.
      // La estrategia la decide la empresa: repartir por turnos, siempre a la
      // misma persona, o dejar sin asignar para que alguien la tome.
      const asesor =
        config.assignmentStrategy === 'FIJA'
          ? config.assignedUserId
          : config.assignmentStrategy === 'ROUND_ROBIN'
            ? await this.assignment.pickNextAgent(companyId, tx)
            : null;

      const lead = await tx.lead.create({
        data: {
          companyId,
          contactId,
          pipelineId: pipeline.id,
          stageId: primeraEtapa.id,
          title: this.tituloPara(input.contactName),
          ...(asesor ? { assignedTo: asesor } : {}),
        },
        select: { id: true, stageId: true },
      });

      // Historial desde el minuto cero, igual que en la creación manual: sin
      // esta primera entrada, el primer cambio de etapa no tendría "desde".
      await tx.leadStageHistory.create({
        data: {
          leadId: lead.id,
          fromStageId: null,
          toStageId: lead.stageId,
          // Nadie la creó a mano: la originó el sistema al entrar el mensaje.
          changedBy: null,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          leadId: lead.id,
          ...(asesor ? { assignedTo: asesor } : {}),
        },
      });

      return {
        leadId: lead.id,
        creado: true,
        assignedTo: asesor,
      };
    });

    await this.avisar(input, resultado);
    return { assignedTo: null, ...resultado };
  }

  /**
   * Avisos y tiempo real, siempre DESPUÉS del commit y sin poder romper nada:
   * la oportunidad ya está creada; un fallo aquí no debe deshacerla.
   */
  private async avisar(
    input: { companyId: string; conversationId: string },
    resultado: {
      leadId: string | null;
      creado: boolean;
      assignedTo?: string | null;
      motivo?: string;
    },
  ): Promise<void> {
    if (!resultado.creado || !resultado.leadId) {
      if (resultado.motivo === 'sin-pipeline') {
        this.logger.warn(
          'Mensaje entrante sin pipeline predeterminado: la conversación queda fuera del tablero',
        );
      }
      return;
    }

    this.realtime.leadUpdated(input.companyId, resultado.leadId);

    if (resultado.assignedTo) {
      await this.notifications.emit({
        companyId: input.companyId,
        recipientUserId: resultado.assignedTo,
        type: 'LEAD_ASSIGNED',
        title: 'Nueva oportunidad asignada',
        bodyPreview: 'Entró por WhatsApp y se te asignó automáticamente.',
        entityType: 'Lead',
        entityId: resultado.leadId,
        actionUrl: '/dashboard/pipeline',
        dedupeKey: `LEAD_ASSIGNED:${resultado.leadId}`,
      });
    } else {
      await this.assignment.warnNobodyAvailable(input.companyId);
    }
  }

  /**
   * Título de la oportunidad. Se usa el nombre del contacto porque es lo que
   * el asesor reconoce de un vistazo en el tablero. Nunca el teléfono: el
   * tablero es una pantalla compartida y visible desde lejos.
   */
  private tituloPara(nombre?: string | null): string {
    const limpio = nombre?.trim();
    return limpio ? `Oportunidad — ${limpio}` : 'Oportunidad desde WhatsApp';
  }
}
