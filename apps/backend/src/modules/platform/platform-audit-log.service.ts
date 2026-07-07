import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Any Prisma client capable of writing an AuditLog row: the main
// PrismaService, or the interactive-transaction client passed into a
// prisma.$transaction(async (tx) => ...) callback. Audit writes are always
// made through whichever one the caller is already inside, so a failed
// audit write rolls back the domain change it was recording alongside.
type AuditLogWriter = Pick<PrismaService, 'auditLog'>;

interface RecordAuditLogInput {
  actorUserId: string;
  actorRole: Role;
  affectedCompanyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface ListAuditLogsFilters {
  action?: string;
  affectedCompanyId?: string;
  actorUserId?: string;
}

@Injectable()
export class PlatformAuditLogService {
  constructor(private prisma: PrismaService) {}

  async record(writer: AuditLogWriter, input: RecordAuditLogInput): Promise<void> {
    try {
      await writer.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          affectedCompanyId: input.affectedCompanyId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          reason: input.reason ?? null,
          metadata: input.metadata ?? Prisma.JsonNull,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch {
      throw new InternalServerErrorException(
        'No se pudo registrar la auditoría de esta acción',
      );
    }
  }

  async list(filters: ListAuditLogsFilters = {}) {
    const where: {
      action?: string;
      affectedCompanyId?: string;
      actorUserId?: string;
    } = {};

    if (filters.action?.trim()) where.action = filters.action.trim();
    if (filters.affectedCompanyId?.trim())
      where.affectedCompanyId = filters.affectedCompanyId.trim();
    if (filters.actorUserId?.trim())
      where.actorUserId = filters.actorUserId.trim();

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        actorUserId: true,
        actorRole: true,
        actor: { select: { id: true, name: true, email: true } },
        affectedCompanyId: true,
        affectedCompany: { select: { id: true, name: true } },
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    });
  }
}
