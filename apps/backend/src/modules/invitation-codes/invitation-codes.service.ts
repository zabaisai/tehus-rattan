import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvitationCodeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { CreateInvitationCodeDto } from './dto/create-invitation-code.dto';
import {
  buildCodePreview,
  generateInvitationCode,
  hashInvitationCode,
  normalizeInvitationCode,
} from './invitation-code.util';

export interface InvitationCodeActor {
  actorUserId: string;
  actorRole: Role;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const VALID_STATUSES = Object.values(InvitationCodeStatus);

const SUMMARY_SELECT = {
  id: true,
  codePreview: true,
  intendedCompanyName: true,
  intendedContactEmail: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  createdByUserId: true,
  createdBy: { select: { id: true, name: true, email: true } },
  usedAt: true,
  usedByUserId: true,
  usedBy: { select: { id: true, name: true, email: true } },
  companyId: true,
  company: { select: { id: true, name: true } },
  revokedAt: true,
  revokedByUserId: true,
  revokedBy: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class InvitationCodesService {
  constructor(
    private prisma: PrismaService,
    private auditLogService: PlatformAuditLogService,
  ) {}

  async create(dto: CreateInvitationCodeDto, actor: InvitationCodeActor) {
    const companyName = dto.intendedCompanyName.trim();
    if (!companyName) {
      throw new BadRequestException('El nombre de la empresa invitada es requerido');
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha de vencimiento debe ser futura');
    }

    const plainCode = generateInvitationCode();
    const normalized = normalizeInvitationCode(plainCode);
    const codeHash = hashInvitationCode(normalized);
    const codePreview = buildCodePreview(plainCode);

    const created = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitationCode.create({
        data: {
          codeHash,
          codePreview,
          intendedCompanyName: companyName,
          intendedContactEmail: dto.intendedContactEmail?.trim().toLowerCase() || undefined,
          expiresAt,
          createdByUserId: actor.actorUserId,
        },
        select: SUMMARY_SELECT,
      });

      // If this write fails, the transaction rolls back the invitation
      // creation too — issuing a code must never go unlogged.
      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        action: 'CREATE_INVITATION_CODE',
        entityType: 'InvitationCode',
        entityId: invitation.id,
        metadata: {
          invitationId: invitation.id,
          codePreview: invitation.codePreview,
          intendedCompanyName: invitation.intendedCompanyName,
          expiresAt: invitation.expiresAt,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return invitation;
    });

    // The only place the plaintext code is ever returned. It is not stored
    // anywhere (only codeHash is) and must never be logged.
    return { ...created, code: plainCode };
  }

  async list(filters: { status?: string } = {}) {
    await this.expireOverdue();

    const where: { status?: InvitationCodeStatus } = {};
    if (filters.status !== undefined) {
      where.status = this.parseStatus(filters.status);
    }

    return this.prisma.invitationCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: SUMMARY_SELECT,
    });
  }

  async revoke(id: string, actor: InvitationCodeActor) {
    await this.expireOverdue();

    const trimmedId = id?.trim();
    if (!trimmedId) {
      throw new BadRequestException('id no puede estar vacio');
    }

    const invitation = await this.prisma.invitationCode.findUnique({
      where: { id: trimmedId },
      select: { id: true, status: true, intendedCompanyName: true, codePreview: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }
    if (invitation.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Solo se pueden revocar invitaciones activas',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Atomic conditional update: if a concurrent request already consumed
      // or revoked this same invitation between the read above and here,
      // `count` comes back 0 and we fail instead of silently overwriting it.
      const result = await tx.invitationCode.updateMany({
        where: { id: trimmedId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: actor.actorUserId,
        },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          'Solo se pueden revocar invitaciones activas',
        );
      }

      await this.auditLogService.record(tx, {
        actorUserId: actor.actorUserId,
        actorRole: actor.actorRole,
        action: 'REVOKE_INVITATION_CODE',
        entityType: 'InvitationCode',
        entityId: trimmedId,
        metadata: {
          invitationId: trimmedId,
          codePreview: invitation.codePreview,
          intendedCompanyName: invitation.intendedCompanyName,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return tx.invitationCode.findUniqueOrThrow({
        where: { id: trimmedId },
        select: SUMMARY_SELECT,
      });
    });
  }

  // Lazily flips ACTIVE rows whose expiresAt has passed to EXPIRED. Cheap
  // (indexed on status) and correct without needing a cron job — called
  // before every list/revoke so the status shown/enforced is never stale.
  private async expireOverdue(): Promise<void> {
    await this.prisma.invitationCode.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  private parseStatus(value: string): InvitationCodeStatus {
    if (!VALID_STATUSES.includes(value as InvitationCodeStatus)) {
      throw new BadRequestException(
        'status debe ser ACTIVE, USED, REVOKED o EXPIRED',
      );
    }
    return value as InvitationCodeStatus;
  }
}
