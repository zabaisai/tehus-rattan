import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { aNumeroParaMostrar } from '../../common/dinero/dinero';

/**
 * EL PERFIL COMERCIAL: un contrato, un origen.
 *
 * Antes, el panel lateral de Conversaciones se armaba con cuatro consultas
 * sueltas desde el navegador, y el Pipeline no tenia panel: para saber quien
 * era una tarjeta habia que abrirla en otra pantalla. Si cada pantalla se
 * construye el suyo, acaban discrepando —una enseña el asesor y la otra no, una
 * cuenta las tareas abiertas y la otra todas— y nadie sabe cual dice la verdad.
 *
 * Esto es lo que ven las dos. Se resuelve en el servidor, acotado por empresa,
 * y viaja una vez.
 */
export interface PerfilComercial {
  contacto: {
    id: string;
    nombre: string | null;
    telefono: string;
    email: string | null;
    etiquetas: string[];
    bloqueado: boolean;
    archivadoEn: string | null;
    motivoDeArchivo: string | null;
    anonimizado: boolean;
    creadoEn: string;
  };
  empresa: { id: string; nombre: string };
  /** La oportunidad ABIERTA mas reciente. Es la que importa para actuar. */
  oportunidad: {
    id: string;
    titulo: string;
    valor: number;
    estado: string;
    pipeline: { id: string; nombre: string };
    etapa: { id: string; nombre: string; color: string | null };
    asesor: { id: string; nombre: string } | null;
  } | null;
  /** La conversacion mas reciente, para poder saltar al chat exacto. */
  conversacion: {
    id: string;
    estado: string;
    pausada: boolean;
    asesor: { id: string; nombre: string } | null;
    ultimoMensaje: {
      cuerpo: string | null;
      entrante: boolean;
      fecha: string;
    } | null;
  } | null;
  tareasPendientes: Array<{
    id: string;
    titulo: string;
    vence: string | null;
    prioridad: string;
  }>;
  cotizaciones: Array<{
    id: string;
    numero: string;
    estado: string;
    total: number;
    creadaEn: string;
  }>;
  camposPersonalizados: Array<{
    key: string;
    label: string;
    valor: string | null;
  }>;
  /**
   * Que esta haciendo el bot en esta conversacion AHORA MISMO.
   *
   * Es lo primero que hay que saber antes de escribir: contestar encima de un
   * bot que esta esperando una respuesta deja al cliente con dos
   * interlocutores a la vez.
   */
  pulso: {
    ejecucionId: string;
    bot: string;
    estado: string;
    esperando: boolean;
    yaPasoAPersona: boolean;
  } | null;
  /** Ultimos movimientos, para no tener que abrir el historial completo. */
  actividad: Array<{
    tipo: 'etapa' | 'nota' | 'cotizacion';
    descripcion: string;
    fecha: string;
  }>;
}

const LIMITE_ACTIVIDAD = 8;

@Injectable()
export class PerfilComercialService {
  constructor(private prisma: PrismaService) {}

  async perfil(contactId: string, companyId: string): Promise<PerfilComercial> {
    const contacto = await this.prisma.contact.findFirst({
      where: { id: contactId, companyId },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!contacto) throw new NotFoundException('Contacto no encontrado');

    // Todo lo de abajo va acotado por companyId ademas de por contactId. El
    // contacto ya esta acotado, pero repetirlo cuesta nada y significa que
    // ninguna de estas consultas puede cruzar empresas si alguien reordena el
    // codigo mas adelante.
    const [oportunidad, conversacion, tareas, cotizaciones, valores] =
      await Promise.all([
        this.prisma.lead.findFirst({
          where: { contactId, companyId, status: 'OPEN' },
          orderBy: { updatedAt: 'desc' },
          include: {
            pipeline: { select: { id: true, name: true } },
            stage: { select: { id: true, name: true, color: true } },
            agent: { select: { id: true, name: true } },
          },
        }),
        this.prisma.conversation.findFirst({
          where: { contactId, companyId },
          orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
          include: {
            agent: { select: { id: true, name: true } },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { body: true, direction: true, createdAt: true },
            },
          },
        }),
        this.prisma.task.findMany({
          where: { contactId, companyId, status: 'PENDING' },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          take: 5,
          select: { id: true, title: true, dueDate: true, priority: true },
        }),
        this.prisma.quote.findMany({
          where: { companyId, lead: { contactId } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            createdAt: true,
          },
        }),
        this.prisma.customFieldValue.findMany({
          where: { contactId, companyId },
          include: {
            definition: { select: { key: true, label: true, type: true } },
          },
        }),
      ]);

    const actividad = await this.actividad(
      contactId,
      companyId,
      oportunidad?.id,
    );

    const ejecucion = conversacion
      ? await this.prisma.flowBotExecution.findFirst({
          where: { conversationId: conversacion.id, companyId },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            status: true,
            flowBot: { select: { name: true } },
          },
        })
      : null;

    return {
      contacto: {
        id: contacto.id,
        nombre: contacto.name,
        telefono: contacto.phone,
        email: contacto.email,
        etiquetas: contacto.tags,
        bloqueado: contacto.isBlocked,
        archivadoEn: contacto.archivedAt?.toISOString() ?? null,
        motivoDeArchivo: contacto.archivedReason,
        anonimizado: contacto.anonymizedAt !== null,
        creadoEn: contacto.createdAt.toISOString(),
      },
      empresa: { id: contacto.company.id, nombre: contacto.company.name },
      oportunidad: oportunidad
        ? {
            id: oportunidad.id,
            titulo: oportunidad.title,
            valor: aNumeroParaMostrar(oportunidad.value),
            estado: oportunidad.status,
            pipeline: {
              id: oportunidad.pipeline.id,
              nombre: oportunidad.pipeline.name,
            },
            etapa: {
              id: oportunidad.stage.id,
              nombre: oportunidad.stage.name,
              color: oportunidad.stage.color,
            },
            asesor: oportunidad.agent
              ? { id: oportunidad.agent.id, nombre: oportunidad.agent.name }
              : null,
          }
        : null,
      conversacion: conversacion
        ? {
            id: conversacion.id,
            estado: conversacion.status,
            pausada: conversacion.isPaused,
            asesor: conversacion.agent
              ? { id: conversacion.agent.id, nombre: conversacion.agent.name }
              : null,
            ultimoMensaje: conversacion.messages[0]
              ? {
                  cuerpo: conversacion.messages[0].body,
                  entrante: conversacion.messages[0].direction === 'INBOUND',
                  fecha: conversacion.messages[0].createdAt.toISOString(),
                }
              : null,
          }
        : null,
      tareasPendientes: tareas.map((t) => ({
        id: t.id,
        titulo: t.title,
        vence: t.dueDate?.toISOString() ?? null,
        prioridad: t.priority,
      })),
      cotizaciones: cotizaciones.map((c) => ({
        id: c.id,
        numero: c.number,
        estado: c.status,
        total: aNumeroParaMostrar(c.total),
        creadaEn: c.createdAt.toISOString(),
      })),
      camposPersonalizados: valores.map((v) => ({
        key: v.definition.key,
        label: v.definition.label,
        valor: this.textoDelValor(v),
      })),
      pulso: ejecucion
        ? {
            ejecucionId: ejecucion.id,
            bot: ejecucion.flowBot.name,
            estado: ejecucion.status,
            esperando:
              ejecucion.status === 'WAITING_INPUT' ||
              ejecucion.status === 'WAITING_TIME',
            // El traspaso a una persona es un ESTADO de la ejecucion, no una
            // marca de tiempo aparte.
            yaPasoAPersona: ejecucion.status === 'HANDED_OFF',
          }
        : null,
      actividad,
    };
  }

  /**
   * Los ultimos movimientos, mezclados y ordenados por fecha.
   *
   * No es el historial completo a proposito: el panel es para decidir el
   * siguiente paso, no para auditar. El historial entero tiene su pantalla.
   */
  private async actividad(
    contactId: string,
    companyId: string,
    leadId: string | undefined,
  ): Promise<PerfilComercial['actividad']> {
    const [etapas, notas, cotizaciones] = await Promise.all([
      leadId
        ? this.prisma.leadStageHistory.findMany({
            where: { leadId },
            orderBy: { changedAt: 'desc' },
            take: LIMITE_ACTIVIDAD,
            select: { toStageId: true, changedAt: true },
          })
        : Promise.resolve([]),
      leadId
        ? this.prisma.note.findMany({
            where: { leadId, companyId },
            orderBy: { createdAt: 'desc' },
            take: LIMITE_ACTIVIDAD,
            select: { content: true, createdAt: true },
          })
        : Promise.resolve([]),
      this.prisma.quote.findMany({
        where: { companyId, lead: { contactId } },
        orderBy: { createdAt: 'desc' },
        take: LIMITE_ACTIVIDAD,
        select: { number: true, createdAt: true },
      }),
    ]);

    // El historial guarda el id de la etapa, no su nombre. Se resuelven en UNA
    // consulta y no una por evento: cinco cambios de etapa no pueden costar
    // cinco viajes a la base solo para pintar una lista.
    const nombresDeEtapa = new Map<string, string>();
    if (etapas.length > 0) {
      const filas = await this.prisma.pipelineStage.findMany({
        where: { id: { in: [...new Set(etapas.map((e) => e.toStageId))] } },
        select: { id: true, name: true },
      });
      for (const f of filas) nombresDeEtapa.set(f.id, f.name);
    }

    const eventos: PerfilComercial['actividad'] = [
      ...etapas.map((e) => ({
        tipo: 'etapa' as const,
        descripcion: `Pasó a «${nombresDeEtapa.get(e.toStageId) ?? 'otra etapa'}»`,
        fecha: e.changedAt.toISOString(),
      })),
      ...notas.map((n) => ({
        tipo: 'nota' as const,
        descripcion: n.content.slice(0, 140),
        fecha: n.createdAt.toISOString(),
      })),
      ...cotizaciones.map((c) => ({
        tipo: 'cotizacion' as const,
        descripcion: `Cotización ${c.number}`,
        fecha: c.createdAt.toISOString(),
      })),
    ];

    return eventos
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, LIMITE_ACTIVIDAD);
  }

  /**
   * Un valor de campo personalizado, en texto.
   *
   * Cada tipo guarda en su propia columna. Devolver el objeto entero obligaria
   * a cada pantalla a saber cual mirar, que es justo la logica duplicada que
   * este servicio existe para evitar.
   */
  private textoDelValor(v: {
    valueText: string | null;
    valueNumber: Prisma.Decimal | null;
    valueDate: Date | null;
    valueBool: boolean | null;
    definition: { type: string };
  }): string | null {
    if (v.valueText !== null) return v.valueText;
    // `valueNumber` es un Decimal. Pasarlo por `String()` con tipo `unknown`
    // daria "[object Object]" en la ficha del cliente si el tipo se aflojara;
    // `.toString()` sobre el Decimal es exacto y no depende de eso.
    if (v.valueNumber !== null && v.valueNumber !== undefined) {
      return v.valueNumber.toString();
    }
    if (v.valueDate) return v.valueDate.toISOString();
    if (v.valueBool !== null) return v.valueBool ? 'Sí' : 'No';
    return null;
  }
}
