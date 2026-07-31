import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEmitter } from '../../common/realtime/realtime.emitter';
import { NotificationsService } from '../notifications/notifications.service';

export type FiltroAsignacion = 'me' | 'unassigned' | 'any' | string;

export interface FiltrosBandeja {
  search?: string;
  status?: string;
  /** `me`, `unassigned`, `any` o el id de un asesor. */
  assigned?: FiltroAsignacion;
  /** Solo las que tienen mensajes que este usuario no ha visto. */
  unread?: boolean;
  /** Solo las que tienen (o no) oportunidad ligada. */
  withLead?: boolean;
  channel?: string;
  limit?: string;
  offset?: string;
}

/** Tope duro: una bandeja no se navega de mil en mil, se filtra. */
export const LIMITE_MAXIMO = 100;
export const LIMITE_POR_DEFECTO = 30;

/** Acciones que se pueden aplicar a varias conversaciones a la vez. */
export type AccionMasiva =
  | { type: 'assign'; assignedTo: string }
  | { type: 'unassign' }
  | { type: 'status'; status: string }
  | { type: 'read' }
  | { type: 'unread' };

/** Tope de una accion masiva: mas que esto es una migracion, no una accion. */
export const MAXIMO_MASIVO = 100;

const ESTADOS = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED', 'ARCHIVED'];

/**
 * Bandeja de conversaciones.
 *
 * Vive aparte de `ConversationsService` porque son dos cosas distintas: aquel
 * gestiona UNA conversacion, este gestiona la LISTA — filtrar, buscar, contar
 * sin leer y actuar sobre muchas a la vez. Mezclarlos convertiria un servicio
 * ya grande en el sitio donde acaba todo.
 *
 * NO LEIDOS: se derivan comparando la marca `lastReadAt` de cada usuario con
 * la fecha de los mensajes ENTRANTES. No hay contador que mantener, asi que no
 * hay contador que se pueda desincronizar; y es por usuario porque la bandeja
 * es compartida: que un supervisor abra un hilo no significa que el asesor
 * asignado ya lo haya visto.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEmitter,
    private readonly notifications: NotificationsService,
  ) {}

  async list(companyId: string, userId: string, filtros: FiltrosBandeja = {}) {
    const { take, skip } = this.paginar(filtros);
    const where = this.construirWhere(companyId, userId, filtros);

    if (filtros.unread) {
      const ids = await this.idsSinLeer(companyId, userId);
      if (!ids.length) return { items: [], hasMore: false };
      where.id = { in: ids };
    }

    const conversaciones = await this.prisma.conversation.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        agent: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        lead: {
          select: {
            id: true,
            title: true,
            status: true,
            stage: { select: { id: true, name: true, color: true } },
          },
        },
        // La marca de lectura SOLO de quien pregunta: traer las de todos
        // filtraria a la interfaz quien ha leido que, y eso no es asunto del
        // resto del equipo.
        reads: { where: { userId }, select: { lastReadAt: true } },
      },
      // Por ultimo mensaje y no por `updatedAt`: `updatedAt` cambia tambien
      // al reasignar o al cambiar de estado, y eso reordenaria la bandeja sin
      // que haya pasado nada nuevo con el cliente.
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: take + 1,
      skip,
    });

    const hayMas = conversaciones.length > take;
    const pagina = hayMas ? conversaciones.slice(0, take) : conversaciones;

    const conNoLeidos = await this.anadirNoLeidos(pagina, userId);
    return { items: conNoLeidos, hasMore: hayMas };
  }

  /** Contadores de la cabecera: se calculan en la base, no en memoria. */
  async counters(companyId: string, userId: string) {
    const [total, mios, sinAsignar, sinLeer] = await Promise.all([
      this.prisma.conversation.count({
        where: { companyId, status: { notIn: ['CLOSED', 'ARCHIVED'] } },
      }),
      this.prisma.conversation.count({
        where: {
          companyId,
          assignedTo: userId,
          status: { notIn: ['CLOSED', 'ARCHIVED'] },
        },
      }),
      this.prisma.conversation.count({
        where: {
          companyId,
          assignedTo: null,
          status: { notIn: ['CLOSED', 'ARCHIVED'] },
        },
      }),
      this.idsSinLeer(companyId, userId).then((ids) => ids.length),
    ]);

    return { total, mine: mios, unassigned: sinAsignar, unread: sinLeer };
  }

  /** Marca leida hasta ahora. Idempotente. */
  async markRead(conversationId: string, companyId: string, userId: string) {
    await this.verificarPertenencia([conversationId], companyId);
    const lastReadAt = new Date();

    await this.prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt },
      update: { lastReadAt },
    });

    // Solo a quien lee: el contador de no leidos es personal.
    this.realtime.toUser(userId, 'v1:conversation.updated', { conversationId });
    return { conversationId, lastReadAt };
  }

  /**
   * Volver a marcar como no leida retrocede la marca ANTES del ultimo mensaje
   * entrante, en vez de borrar la fila. Borrarla dejaria la conversacion
   * entera sin leer, incluidos meses de historial que el asesor si habia
   * visto, y el contador saltaria a decenas sin motivo.
   */
  async markUnread(conversationId: string, companyId: string, userId: string) {
    await this.verificarPertenencia([conversationId], companyId);

    const ultimoEntrante = await this.prisma.message.findFirst({
      where: { conversationId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (!ultimoEntrante) return { conversationId, lastReadAt: null };

    const lastReadAt = new Date(ultimoEntrante.createdAt.getTime() - 1);
    await this.prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt },
      update: { lastReadAt },
    });

    this.realtime.toUser(userId, 'v1:conversation.updated', { conversationId });
    return { conversationId, lastReadAt };
  }

  /**
   * Acciones sobre varias conversaciones.
   *
   * TODAS las conversaciones se comprueban contra la empresa ANTES de tocar
   * nada: un id ajeno colado en la lista no debe modificar una conversacion
   * de otra empresa ni "por si acaso". Si alguno no pertenece, no se aplica
   * ninguna — a medias seria peor que nada, porque el usuario no sabria cual.
   */
  async bulk(
    companyId: string,
    userId: string,
    conversationIds: string[],
    accion: AccionMasiva,
  ) {
    const ids = [...new Set(conversationIds)].filter(Boolean);
    if (!ids.length) throw new BadRequestException('No hay conversaciones');
    if (ids.length > MAXIMO_MASIVO) {
      throw new BadRequestException(
        `No se pueden modificar mas de ${MAXIMO_MASIVO} conversaciones a la vez`,
      );
    }

    await this.verificarPertenencia(ids, companyId);

    switch (accion.type) {
      case 'assign':
        return this.asignarEnLote(companyId, ids, accion.assignedTo);
      case 'unassign':
        return this.aplicar(ids, { assignedTo: null }, companyId);
      case 'status':
        if (!ESTADOS.includes(accion.status)) {
          throw new BadRequestException('Estado no valido');
        }
        return this.aplicar(
          ids,
          { status: accion.status as never },
          companyId,
        );
      case 'read':
        return this.marcarEnLote(ids, userId, companyId, true);
      case 'unread':
        return this.marcarEnLote(ids, userId, companyId, false);
    }
  }

  /**
   * Ids de las conversaciones con algun mensaje entrante posterior a la marca
   * de lectura de este usuario.
   *
   * Va en SQL porque la condicion correlaciona tres tablas: cada mensaje se
   * compara con la marca de SU conversacion para ESTE usuario. Prisma no
   * permite referirse al campo de una relacion hermana dentro de un filtro
   * anidado, y las alternativas -traer todas las marcas y montar un OR gigante
   * en memoria- se degradan con el tamano de la bandeja.
   *
   * `LEFT JOIN` y no `INNER`: quien nunca abrio la conversacion tambien la
   * tiene sin leer, y con un INNER esas desaparecerian justo del filtro que
   * las busca.
   */
  private async idsSinLeer(
    companyId: string,
    userId: string,
  ): Promise<string[]> {
    const filas = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM conversations c
      LEFT JOIN conversation_reads r
        ON r."conversationId" = c.id AND r."userId" = ${userId}
      WHERE c."companyId" = ${companyId}
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m."conversationId" = c.id
            AND m.direction = 'INBOUND'::"Direction"
            AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
        )
      ORDER BY c."lastMessageAt" DESC NULLS LAST
      LIMIT ${LIMITE_MAXIMO * 5}
    `;
    return filas.map((f) => f.id);
  }

  // ── internos ────────────────────────────────────────────────

  private construirWhere(
    companyId: string,
    userId: string,
    f: FiltrosBandeja,
  ): Prisma.ConversationWhereInput {
    const where: Prisma.ConversationWhereInput = { companyId };

    if (f.search?.trim()) {
      const q = f.search.trim();
      where.contact = {
        is: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
      };
    }

    if (f.status && ESTADOS.includes(f.status)) {
      where.status = f.status as never;
    }

    if (f.assigned === 'me') where.assignedTo = userId;
    else if (f.assigned === 'unassigned') where.assignedTo = null;
    else if (f.assigned && f.assigned !== 'any') where.assignedTo = f.assigned;

    if (f.channel?.trim()) where.channel = f.channel.trim();

    if (f.withLead === true) where.leadId = { not: null };
    else if (f.withLead === false) where.leadId = null;

    // El filtro de no leidos NO se construye aqui: necesita correlacionar
    // cada mensaje con la marca de lectura de SU conversacion, y eso no se
    // puede expresar en el lenguaje de consultas de Prisma. Se resuelve en
    // `idsSinLeer()` con SQL y se inyecta como un `id IN (...)`.

    return where;
  }

  /**
   * Cuenta los entrantes posteriores a la marca de lectura de cada
   * conversacion. Va en una consulta agrupada y no una por hilo: con una
   * bandeja de treinta conversaciones serian treinta consultas.
   */
  private async anadirNoLeidos(
    conversaciones: Array<{
      id: string;
      reads?: Array<{ lastReadAt: Date }>;
      [k: string]: unknown;
    }>,
    userId: string,
  ) {
    if (!conversaciones.length) return [];

    const marcas = new Map(
      conversaciones.map((c) => [c.id, c.reads?.[0]?.lastReadAt ?? null]),
    );

    const grupos = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversaciones.map((c) => c.id) },
        direction: 'INBOUND',
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    // Para contar solo los posteriores a la marca hace falta el detalle, asi
    // que se piden las fechas de los entrantes de golpe. Sigue siendo UNA
    // consulta, acotada a la pagina que se esta mostrando.
    const entrantes = await this.prisma.message.findMany({
      where: {
        conversationId: { in: conversaciones.map((c) => c.id) },
        direction: 'INBOUND',
      },
      select: { conversationId: true, createdAt: true },
    });

    const sinLeer = new Map<string, number>();
    for (const m of entrantes) {
      const marca = marcas.get(m.conversationId);
      if (!marca || m.createdAt > marca) {
        sinLeer.set(m.conversationId, (sinLeer.get(m.conversationId) ?? 0) + 1);
      }
    }

    void grupos;
    return conversaciones.map(({ reads, ...c }) => ({
      ...c,
      unreadCount: sinLeer.get(c.id as string) ?? 0,
      lastReadAt: reads?.[0]?.lastReadAt ?? null,
    }));
  }

  private paginar(f: FiltrosBandeja) {
    const take = Math.min(
      Math.max(Number(f.limit) || LIMITE_POR_DEFECTO, 1),
      LIMITE_MAXIMO,
    );
    const skip = Math.max(Number(f.offset) || 0, 0);
    return { take, skip };
  }

  /** Lanza si alguno de los ids no es de esta empresa. */
  private async verificarPertenencia(ids: string[], companyId: string) {
    const propias = await this.prisma.conversation.count({
      where: { id: { in: ids }, companyId },
    });
    if (propias !== ids.length) {
      throw new BadRequestException(
        'Alguna conversacion no pertenece a esta empresa',
      );
    }
  }

  private async asignarEnLote(
    companyId: string,
    ids: string[],
    assignedTo: string,
  ) {
    const destino = await this.prisma.user.findFirst({
      where: { id: assignedTo, companyId, isActive: true },
      select: { id: true },
    });
    if (!destino) {
      throw new BadRequestException('El asesor no pertenece a esta empresa');
    }

    const resultado = await this.aplicar(ids, { assignedTo }, companyId);

    // Un solo aviso por lote, no uno por conversacion: veinte notificaciones
    // seguidas no informan, sepultan.
    await this.notifications.emit({
      companyId,
      recipientUserId: assignedTo,
      type: 'CONVERSATION_ASSIGNED',
      title:
        ids.length === 1
          ? 'Te asignaron una conversacion'
          : `Te asignaron ${ids.length} conversaciones`,
      entityType: 'Conversation',
      entityId: ids[0],
      actionUrl: '/dashboard/conversations',
      dedupeKey: `CONVERSATION_ASSIGNED_BULK:${assignedTo}:${ids.join(',').slice(0, 80)}`,
    });

    return resultado;
  }

  private async aplicar(
    ids: string[],
    data: Prisma.ConversationUncheckedUpdateManyInput,
    companyId: string,
  ) {
    const { count } = await this.prisma.conversation.updateMany({
      // El companyId se repite aqui aunque ya se haya verificado: si alguien
      // reordena el codigo y se salta la verificacion, la consulta sigue sin
      // poder tocar otra empresa.
      where: { id: { in: ids }, companyId },
      data,
    });

    for (const conversationId of ids) {
      this.realtime.toCompany(companyId, 'v1:conversation.updated', {
        conversationId,
      });
    }

    return { updated: count };
  }

  private async marcarEnLote(
    ids: string[],
    userId: string,
    companyId: string,
    leidas: boolean,
  ) {
    for (const id of ids) {
      if (leidas) await this.markRead(id, companyId, userId);
      else await this.markUnread(id, companyId, userId);
    }
    return { updated: ids.length };
  }
}
