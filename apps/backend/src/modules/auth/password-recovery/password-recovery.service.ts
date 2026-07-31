import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { SessionsService } from '../../sessions/sessions.service';
import { MailService } from '../../mail/mail.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { hashToken } from '../../sessions/utils/token.util';

// Same generic reply for every valid forgot-password call — existing, missing,
// inactive, or blocked account. Never reveals whether an account exists.
export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'Si existe una cuenta asociada a este correo, recibirás las instrucciones para restablecer tu contraseña.';
export const RESET_PASSWORD_SUCCESS_MESSAGE =
  'Tu contraseña fue actualizada. Inicia sesión nuevamente.';
export const RESET_PASSWORD_INVALID_MESSAGE =
  'El enlace de recuperación es inválido o expiró. Solicita uno nuevo.';
export const ADMIN_SEND_RESET_MESSAGE =
  'Solicitud registrada. Si la cuenta puede recibirlo, se enviaron las instrucciones.';

const BCRYPT_SALT_ROUNDS = 10;

export interface RecoveryActor {
  userId: string;
  role: Role;
  companyId: string | null;
}

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PasswordResetTokenService,
    private readonly mail: MailService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  // ---- public: forgot password (anti-enumeration) --------------------------
  // Resolves the account by normalized email and, if eligible, issues + emails a
  // token. ALWAYS resolves without signalling existence — the controller returns
  // the same generic message regardless of outcome.
  async requestReset(
    rawEmail: string,
    requestedIpPreview: string | null,
  ): Promise<void> {
    const email = this.normalizeEmail(rawEmail);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        companyId: true,
        company: { select: { status: true } },
      },
    });

    const eligible =
      !!user &&
      user.isActive &&
      (user.companyId === null || user.company?.status === 'ACTIVE');

    if (!eligible) {
      // Balance the DB work of the eligible branch (which does a cooldown read)
      // so an existing vs non-existing account is not obviously different in
      // timing. Never signals existence.
      await this.prisma.passwordResetToken
        .findFirst({ where: { id: '__none__' }, select: { id: true } })
        .catch(() => null);
      return;
    }

    const plainToken = await this.tokens.issueForUser(
      user.id,
      requestedIpPreview,
    );
    if (!plainToken) return; // resend cooldown — still generic

    await this.deliverAndAudit({
      user: user,
      plainToken,
      requestedIpPreview,
      action: 'PASSWORD_RESET_REQUESTED',
      actorUserId: user.id,
      actorRole: user.role,
    });
  }

  // ---- public: reset password (atomic) -------------------------------------
  async resetPassword(
    plainToken: string,
    newPassword: string,
    passwordConfirmation: string,
    ipPreview: string | null,
  ): Promise<void> {
    if (newPassword !== passwordConfirmation) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }

    // Look up the owning user (outside the tx) to run the "must differ from
    // current" check and pre-hash — keeping bcrypt out of the transaction. The
    // authoritative single-use guard is the atomic consume inside the tx below.
    const owner = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(plainToken) },
      select: { userId: true },
    });
    // Do NOT early-return on a missing token in a way that differs from an
    // expired/used one — all invalid cases end with the same generic error.
    if (!owner) throw new BadRequestException(RESET_PASSWORD_INVALID_MESSAGE);

    const user = await this.prisma.user.findUnique({
      where: { id: owner.userId },
      select: {
        id: true,
        password: true,
        role: true,
        companyId: true,
        isActive: true,
      },
    });
    if (!user || !user.isActive) {
      throw new BadRequestException(RESET_PASSWORD_INVALID_MESSAGE);
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
    if (sameAsCurrent) {
      throw new BadRequestException(
        'La nueva contraseña no puede ser igual a la actual.',
      );
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    // Atomic: consume the token (CAS), change the password, revoke every
    // session, and write both audit rows — all or nothing.
    const revokedCount = await this.prisma.$transaction(async (tx) => {
      const consumedUserId = await this.tokens.consumeWithin(plainToken, tx);
      if (consumedUserId !== user.id) {
        // Lost the race, or the token expired/was used/revoked in between.
        throw new BadRequestException(RESET_PASSWORD_INVALID_MESSAGE);
      }

      await tx.user.update({
        where: { id: user.id },
        data: { password: newHash },
      });

      const revoked = await this.sessions.revokeAllActiveForUser(
        user.id,
        user.id,
        tx,
      );

      await this.recordAudit(tx, {
        actorUserId: user.id,
        actorRole: user.role,
        affectedCompanyId: user.companyId,
        action: 'PASSWORD_RESET_COMPLETED',
        entityId: user.id,
        ipPreview,
      });
      await this.recordAudit(tx, {
        actorUserId: user.id,
        actorRole: user.role,
        affectedCompanyId: user.companyId,
        action: 'SESSIONS_REVOKED_AFTER_PASSWORD_RESET',
        entityId: user.id,
        metadata: { revokedSessions: revoked },
        ipPreview,
      });

      return revoked;
    });

    this.logger.log(
      `Password reset completed; ${revokedCount} session(s) revoked`,
    );
  }

  // ---- admin-initiated send ------------------------------------------------
  // SUPER_ADMIN: any active user. ADMIN: only an AGENT of the admin's OWN
  // company. Enforced here (backend), not just by guards. Never returns the
  // token/link; the admin cannot set the password.
  async adminSendReset(
    actor: RecoveryActor,
    targetUserId: string,
    ipPreview: string | null,
  ): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        companyId: true,
        company: { select: { status: true } },
      },
    });

    if (!target || !target.isActive) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const targetCompanyActive =
      target.companyId === null || target.company?.status === 'ACTIVE';
    if (!targetCompanyActive) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    if (actor.role === 'ADMIN') {
      const sameCompany =
        !!actor.companyId && target.companyId === actor.companyId;
      // Cross-tenant target: behave as if it does not exist (404) so an admin
      // cannot even probe whether a user id belongs to another company.
      if (!sameCompany) {
        throw new NotFoundException('Usuario no encontrado.');
      }
      // Same company but not an AGENT (e.g. another ADMIN): visible, but not
      // allowed → 403.
      if (target.role !== 'AGENT') {
        throw new ForbiddenException(
          'Solo puedes enviar recuperación a asesores de tu empresa.',
        );
      }
    } else if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('No autorizado.');
    }

    const plainToken = await this.tokens.issueForUser(target.id, ipPreview);
    if (!plainToken) return; // resend cooldown — request still "registered"

    await this.deliverAndAudit({
      user: target,
      plainToken,
      requestedIpPreview: ipPreview,
      action:
        actor.role === 'SUPER_ADMIN'
          ? 'PASSWORD_RESET_SENT_BY_SUPER_ADMIN'
          : 'PASSWORD_RESET_SENT_BY_ADMIN',
      actorUserId: actor.userId,
      actorRole: actor.role,
    });
  }

  // ---- helpers -------------------------------------------------------------
  private async deliverAndAudit(params: {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      companyId: string | null;
    };
    plainToken: string;
    requestedIpPreview: string | null;
    action: string;
    actorUserId: string;
    actorRole: Role;
  }): Promise<void> {
    const resetUrl = this.buildResetUrl(params.plainToken);
    try {
      await this.mail.sendPasswordResetEmail({
        to: params.user.email,
        name: params.user.name,
        resetUrl,
        ttlMinutes: this.tokens.ttlMinutes(),
      });
    } catch (error) {
      // Compensating: revoke the just-issued token so nothing usable lingers,
      // log without any token/recipient, and keep the outward response generic.
      await this.tokens.revokeByPlainToken(params.plainToken).catch(() => null);
      this.logger.error(
        'Password reset email failed to send',
        error instanceof Error ? error.stack : undefined,
      );
      return;
    }

    await this.recordAudit(this.prisma, {
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      affectedCompanyId: params.user.companyId,
      action: params.action,
      entityId: params.user.id,
      ipPreview: params.requestedIpPreview,
    });
  }

  // Only ever builds the URL from the configured PASSWORD_RESET_URL — never from
  // any client-supplied value, so there is no open-redirect surface.
  private buildResetUrl(plainToken: string): string {
    const base =
      this.config.get<string>('PASSWORD_RESET_URL')?.trim() ||
      'http://localhost:3000/reset-password';
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}token=${encodeURIComponent(plainToken)}`;
  }

  private normalizeEmail(rawEmail: string): string {
    return String(rawEmail ?? '')
      .trim()
      .toLowerCase();
  }

  private async recordAudit(
    writer: Pick<PrismaService, 'auditLog'>,
    input: {
      actorUserId: string;
      actorRole: Role;
      affectedCompanyId: string | null;
      action: string;
      entityId: string;
      metadata?: Prisma.InputJsonValue;
      ipPreview?: string | null;
    },
  ): Promise<void> {
    await writer.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        affectedCompanyId: input.affectedCompanyId,
        action: input.action,
        entityType: 'User',
        entityId: input.entityId,
        // Only the anonymized (truncated) IP — never a raw address, never a
        // token, never the reset URL.
        ipAddress: input.ipPreview ?? null,
        metadata: input.metadata,
      },
    });
  }
}
