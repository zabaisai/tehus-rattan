import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ZONA_POR_DEFECTO,
  dentroDeHorario as dentroDeHorarioEnZona,
} from '../../../common/time/zona-horaria';

/**
 * Elige qué bot atiende un evento.
 *
 * ES DETERMINISTA A PROPÓSITO. Si dos bots encajan con el mismo mensaje, cuál
 * responde no puede depender del orden en que la base devuelva las filas: hoy
 * contestaría uno, mañana otro, y nadie sabría por qué. El desempate está
 * escrito y el resultado queda registrado con el motivo de cada descarte.
 */

export type TipoEvento =
  | 'INBOUND_MESSAGE'
  | 'FIRST_CONVERSATION'
  | 'KEYWORD'
  | 'CONVERSATION_CREATED'
  | 'CONTACT_CREATED'
  | 'LEAD_CREATED'
  | 'STAGE_CHANGED'
  | 'TAG_ADDED'
  | 'TASK_OVERDUE'
  | 'NO_REPLY'
  | 'SCHEDULE'
  | 'MANUAL'
  | 'WEBHOOK'
  | 'AUTOMATION_EVENT';

export interface EventoEntrante {
  companyId: string;
  tipo: TipoEvento;
  conversationId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  whatsappIntegrationId?: string | null;
  /** Texto del mensaje, para los disparadores por palabra clave. */
  texto?: string;
  pipelineId?: string | null;
  stageId?: string | null;
  etiqueta?: string | null;
  /** ¿Es la primera conversación de este contacto? */
  esPrimeraConversacion?: boolean;
  /**
   * Zona de la empresa. Si no llega, la resuelve el selector consultándola.
   *
   * Se admite por parámetro para que el simulador pueda probar «¿qué pasaría
   * un domingo a las 3 de la mañana?» sin tocar la configuración real.
   */
  zonaHoraria?: string;
}

export interface Candidato {
  flowBotId: string;
  triggerId: string;
  versionId: string;
  prioridad: number;
  exclusivo: boolean;
  nombre: string;
}

export interface Descartado {
  flowBotId: string;
  nombre: string;
  motivo: string;
}

export interface Seleccion {
  /** Los que arrancarán, en orden. */
  elegidos: Candidato[];
  /** Los que no, con el porqué. Se guarda para poder explicarlo después. */
  descartados: Descartado[];
}

@Injectable()
export class FlowBotSelectorService {
  private readonly logger = new Logger(FlowBotSelectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bots aplicables a un evento.
   *
   * Solo mira bots ACTIVE con versión publicada: un borrador nunca se ejecuta,
   * y una versión sin publicar tampoco. Es lo que impide que alguien
   * experimente en el editor y el experimento le conteste a un cliente.
   */
  async seleccionar(
    evento: EventoEntrante,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Seleccion> {
    const disparadores = await tx.flowBotTrigger.findMany({
      where: {
        type: evento.tipo,
        enabled: true,
        flowBot: {
          // El filtro por empresa va aquí, en la consulta: nunca se traen bots
          // de otras empresas para descartarlos después.
          companyId: evento.companyId,
          status: 'ACTIVE',
          isTemplate: false,
          publishedVersionId: { not: null },
        },
        // Un disparador atado a un número solo aplica a ese número; uno sin
        // número aplica a cualquiera de la empresa.
        OR: [
          { whatsappIntegrationId: null },
          ...(evento.whatsappIntegrationId
            ? [{ whatsappIntegrationId: evento.whatsappIntegrationId }]
            : []),
        ],
      },
      // El desempate es explícito y estable: prioridad, luego el bot más
      // reciente, y finalmente el id. Sin el último criterio, dos bots con la
      // misma prioridad creados en el mismo instante volverían a depender del
      // azar.
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        priority: true,
        exclusive: true,
        filters: true,
        flowBot: {
          select: { id: true, name: true, publishedVersionId: true },
        },
      },
    });

    const elegidos: Candidato[] = [];
    const descartados: Descartado[] = [];

    // La zona de la EMPRESA, no la del servidor: un horario «de 8 a 18»
    // configurado en Bogotá tiene que respetarse aunque el contenedor corra
    // en UTC, que es lo habitual.
    //
    // SE RESUELVE PEREZOSAMENTE. Casi ningún disparador declara horario, y
    // consultar la empresa en cada mensaje entrante para no usarla nunca es
    // una consulta por mensaje regalada.
    const zona = await this.zonaDeLaEmpresa(evento, disparadores, tx);

    for (const t of disparadores) {
      const bot = t.flowBot;
      if (!bot.publishedVersionId) {
        descartados.push({
          flowBotId: bot.id,
          nombre: bot.name,
          motivo: 'sin versión publicada',
        });
        continue;
      }

      const motivo = this.noPasaFiltros(t.filters, evento, zona);
      if (motivo) {
        descartados.push({ flowBotId: bot.id, nombre: bot.name, motivo });
        continue;
      }

      // Exclusividad: en cuanto uno exclusivo entra, nadie más arranca. Sin
      // esto, dos bots contestarían a la vez al mismo cliente, que es el fallo
      // más visible y más difícil de explicar de todos.
      if (elegidos.some((e) => e.exclusivo)) {
        descartados.push({
          flowBotId: bot.id,
          nombre: bot.name,
          motivo: `otro bot exclusivo de mayor prioridad ya atiende esta conversación`,
        });
        continue;
      }

      elegidos.push({
        flowBotId: bot.id,
        triggerId: t.id,
        versionId: bot.publishedVersionId,
        prioridad: t.priority,
        exclusivo: t.exclusive,
        nombre: bot.name,
      });
    }

    return { elegidos, descartados };
  }

  /**
   * La zona de la empresa, solo si de verdad hace falta.
   *
   * Si el evento la trae —el simulador la fija para preguntar «¿qué pasaría
   * un domingo?»— se usa esa. Si ningún disparador declara horario, no se
   * consulta nada: el valor no se llegaría a mirar.
   */
  private async zonaDeLaEmpresa(
    evento: EventoEntrante,
    disparadores: Array<{ filters: unknown }>,
    tx: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    if (evento.zonaHoraria) return evento.zonaHoraria;

    const alguienTieneHorario = disparadores.some((d) => {
      const f = d.filters;
      return Boolean(f && typeof f === 'object' && 'businessHours' in f);
    });
    if (!alguienTieneHorario) return ZONA_POR_DEFECTO;

    const empresa = await tx.company.findUnique({
      where: { id: evento.companyId },
      select: { timezone: true },
    });
    return empresa?.timezone ?? ZONA_POR_DEFECTO;
  }

  /**
   * Filtros del disparador. Devuelve el motivo del descarte, o `null` si pasa.
   *
   * Los filtros son datos, no código: cada clave tiene una comprobación
   * concreta. Una clave desconocida NO descarta —un filtro que no entendemos
   * no debe silenciar un bot— pero se registra.
   */
  private noPasaFiltros(
    filters: unknown,
    evento: EventoEntrante,
    zona: string,
  ): string | null {
    if (!filters || typeof filters !== 'object') return null;
    const f = filters as Record<string, unknown>;

    if (Array.isArray(f.keywords) && f.keywords.length > 0) {
      const texto = normalizar(evento.texto ?? '');
      const encaja = f.keywords.some(
        (k) => typeof k === 'string' && texto.includes(normalizar(k)),
      );
      if (!encaja) return 'el mensaje no contiene ninguna palabra clave';
    }

    if (
      typeof f.pipelineId === 'string' &&
      f.pipelineId !== evento.pipelineId
    ) {
      return 'la oportunidad está en otro pipeline';
    }
    if (typeof f.stageId === 'string' && f.stageId !== evento.stageId) {
      return 'la oportunidad está en otra etapa';
    }
    if (
      typeof f.tag === 'string' &&
      normalizar(f.tag) !== normalizar(evento.etiqueta ?? '')
    ) {
      return 'la etiqueta no coincide';
    }
    if (f.onlyFirstConversation === true && !evento.esPrimeraConversacion) {
      return 'no es la primera conversación de este contacto';
    }

    // Horario comercial. Se compara en la zona horaria indicada; sin ella se
    // usa la del servidor, que en staging y producción es la de Colombia.
    if (f.businessHours && typeof f.businessHours === 'object') {
      const dentro = dentroDeHorarioEnZona(new Date(), zona, f.businessHours);
      // `null` = configuración ilegible. NO descarta: un horario con una
      // errata no puede silenciar un bot sin que nadie se entere.
      if (dentro === false) return 'fuera del horario configurado';
    }

    return null;
  }
}

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
