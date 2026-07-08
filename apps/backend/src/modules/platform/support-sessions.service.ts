import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, SupportSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupportSessionDto } from './dto/create-support-session.dto';
import { PlatformAuditLogService } from './platform-audit-log.service';

const SUPPORT_SESSION_TTL_MINUTES = 30;
const REASON_MAX_LENGTH = 500;
const VALID_STATUSES = Object.values(SupportSessionStatus);

export interface AuditActor {
  actorUserId: string;
  actorRole: Role;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface ListSupportSessionsFilters {
  companyId?: string;
  status?: string;
}

const SESSION_SELECT = {
  id: true,
  actorUserId: true,
  companyId: true,
  reason: true,
  status: true,
  expiresAt: true,
  endedAt: true,
  createdAt: true,
  company: { select: { id: true, name: true, status: true } },
} as const;

type SessionWithCompany = {
  id: string;
  actorUserId: string;
  companyId: string;
  reason: string;
  status: SupportSessionStatus;
  expiresAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  company: { id: string; name: string; status: string };
};

@Injectable()
export class SupportSessionsService {
  constructor(
    private prisma: PrismaService,
    private auditLogService: PlatformAuditLogService,
  ) {}

  async createSession(dto: CreateSupportSessionDto, actor: AuditActor) {
    const companyId = this.requireNonBlank(
      dto.companyId,
      'companyId no puede estar vacio',
    );
    const reason = this.requireReason(dto.reason);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, status: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }
    if (company.status === 'DELETED') {
      throw new BadRequestException(
        'No se puede iniciar una sesión de soporte para una empresa eliminada',
      );
    }

    const existingActive = await this.prisma.supportSession.findFirst({
      where: {
        actorUserId: actor.actorUserId,
        companyId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existingActive) {
      throw new ConflictException(
        'Ya existe una sesión de soporte activa para esta empresa',
      );
    }

    const expiresAt = new Date(
      Date.now() + SUPPORT_SESSION_TTL_MINUTES * 60 * 1000,
    );

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportSession.create({
        data: {
          actorUserId: actor.actorUserId,
          companyId,
          reason,
          expiresAt,
        },
        select: SESSION_SELECT,
      });

      // If this write fails, the transaction rolls back the SupportSession
      // creation too — access to a company's data must never go unlogged.
      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: companyId,
        action: 'START_SUPPORT_SESSION',
        entityType: 'SupportSession',
        entityId: created.id,
        metadata: {
          supportSessionId: created.id,
          companyId,
          companyName: created.company.name,
          reason,
          expiresAt: created.expiresAt.toISOString(),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });

    return this.toSessionResponse(session);
  }

  async endSession(id: string, actor: AuditActor) {
    const trimmedId = this.requireNonBlank(id, 'id no puede estar vacio');

    const session = await this.prisma.supportSession.findUnique({
      where: { id: trimmedId },
      select: SESSION_SELECT,
    });

    // Not found and "found but belongs to someone else" return the same
    // 404 — confirming that a session exists for another actor would leak
    // information a platform admin shouldn't get from probing IDs.
    if (!session || session.actorUserId !== actor.actorUserId) {
      throw new NotFoundException('Sesión de soporte no encontrada');
    }

    if (session.status === 'ENDED') {
      throw new ConflictException('La sesión de soporte ya fue cerrada');
    }

    const isPastDue = session.expiresAt <= new Date();
    if (session.status === 'EXPIRED' || isPastDue) {
      if (session.status === 'ACTIVE') {
        // Lazily sync the true state before rejecting: the session lapsed
        // on its own, so there is nothing left for this actor to "end".
        await this.prisma.supportSession.update({
          where: { id: trimmedId },
          data: { status: 'EXPIRED' },
        });
      }
      throw new ConflictException(
        'La sesión de soporte ya expiró y no puede cerrarse',
      );
    }

    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - session.createdAt.getTime()) / 1000,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.supportSession.update({
        where: { id: trimmedId },
        data: { status: 'ENDED', endedAt },
        select: SESSION_SELECT,
      });

      // Same rule as creation: if this write fails, the closing update
      // rolls back too — closing a support session must never go unlogged.
      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        affectedCompanyId: closed.companyId,
        action: 'END_SUPPORT_SESSION',
        entityType: 'SupportSession',
        entityId: closed.id,
        metadata: {
          supportSessionId: closed.id,
          companyId: closed.companyId,
          companyName: closed.company.name,
          durationSeconds,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return closed;
    });

    return this.toSessionResponse(updated);
  }

  async listSessions(
    actorUserId: string,
    filters: ListSupportSessionsFilters = {},
  ) {
    const where: {
      actorUserId: string;
      companyId?: string;
      status?: SupportSessionStatus;
    } = { actorUserId };

    if (filters.companyId?.trim()) {
      where.companyId = filters.companyId.trim();
    }
    if (filters.status !== undefined) {
      where.status = this.parseStatus(filters.status);
    }

    const sessions = await this.prisma.supportSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: SESSION_SELECT,
    });

    return sessions.map((session) => this.toListItem(session));
  }

  // Used by support-mode endpoints to gate access to a company's data
  // behind a live, owned SupportSession. Deliberately read-only — no lazy
  // EXPIRED write here, so a plain authorization check never mutates state.
  async validateActiveSupportSession(sessionId: string, actorUserId: string) {
    const trimmedId = this.requireNonBlank(
      sessionId,
      'id no puede estar vacio',
    );

    const session = await this.prisma.supportSession.findUnique({
      where: { id: trimmedId },
      select: {
        id: true,
        actorUserId: true,
        companyId: true,
        status: true,
        expiresAt: true,
        company: { select: { id: true, name: true } },
      },
    });

    if (!session || session.actorUserId !== actorUserId) {
      throw new NotFoundException('Sesión de soporte no encontrada');
    }

    if (session.status !== 'ACTIVE') {
      throw new ForbiddenException('La sesión de soporte no está activa');
    }

    if (session.expiresAt <= new Date()) {
      throw new ForbiddenException('La sesión de soporte expiró');
    }

    return session;
  }

  async listSessionConversations(
    sessionId: string,
    actor: AuditActor,
    filters: { page?: string; limit?: string } = {},
  ) {
    const session = await this.validateActiveSupportSession(
      sessionId,
      actor.actorUserId,
    );
    const { page, limit, skip, take } = this.parsePagination(
      filters.page,
      filters.limit,
    );

    // Explicit select, not the business ConversationsService.findAll — that
    // one intentionally includes the last message. A support session must
    // never surface message content, so this query is built from scratch.
    const conversations = await this.prisma.conversation.findMany({
      where: { companyId: session.companyId },
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        status: true,
        channel: true,
        createdAt: true,
        updatedAt: true,
        contact: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });

    const items = conversations.map((conversation) => ({
      id: conversation.id,
      status: conversation.status,
      channel: conversation.channel,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      contact: conversation.contact,
      assignedUser: conversation.agent,
    }));

    // Read-only view, so there is no domain write to roll back — but per
    // the "no sensitive access without traceability" rule, the audit write
    // still happens before returning anything, and its own failure (it
    // throws InternalServerErrorException) fails the whole request rather
    // than silently letting the SUPER_ADMIN see the list unlogged.
    await this.auditLogService.record(this.prisma, {
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      affectedCompanyId: session.companyId,
      action: 'VIEW_SUPPORT_CONVERSATIONS',
      entityType: 'SupportSession',
      entityId: session.id,
      metadata: {
        supportSessionId: session.id,
        companyId: session.companyId,
        companyName: session.company.name,
        resultCount: items.length,
        page,
        limit,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return items;
  }

  private parsePagination(pageInput?: string, limitInput?: string) {
    let page = 1;
    if (pageInput !== undefined) {
      page = Number(pageInput);
      if (!Number.isInteger(page) || page < 1) {
        throw new BadRequestException('page debe ser un entero mayor o igual a 1');
      }
    }

    let limit = 20;
    if (limitInput !== undefined) {
      limit = Number(limitInput);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestException('limit debe ser un entero entre 1 y 50');
      }
    }

    return { page, limit, skip: (page - 1) * limit, take: limit };
  }

  private parseStatus(value: string): SupportSessionStatus {
    if (!VALID_STATUSES.includes(value as SupportSessionStatus)) {
      throw new BadRequestException('status debe ser ACTIVE, ENDED o EXPIRED');
    }
    return value as SupportSessionStatus;
  }

  private requireNonBlank(
    value: string | undefined,
    message: string,
  ): string {
    if (!value?.trim()) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }

  private requireReason(value: string | undefined): string {
    const reason = this.requireNonBlank(value, 'reason no puede estar vacio');
    if (reason.length > REASON_MAX_LENGTH) {
      throw new BadRequestException(
        'reason no puede superar 500 caracteres',
      );
    }
    return reason;
  }

  private toSessionResponse(session: SessionWithCompany) {
    return {
      id: session.id,
      actorUserId: session.actorUserId,
      companyId: session.companyId,
      company: session.company,
      reason: session.reason,
      status: session.status,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      createdAt: session.createdAt,
    };
  }

  private toListItem(session: SessionWithCompany) {
    return {
      id: session.id,
      company: session.company,
      reason: session.reason,
      status: session.status,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      createdAt: session.createdAt,
    };
  }
}
