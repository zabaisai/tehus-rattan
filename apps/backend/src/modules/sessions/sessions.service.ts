import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionRequestContext } from './utils/request-context.util';
import { generateOpaqueToken, hashToken } from './utils/token.util';
import { isSessionInactiveExpired } from './sessions.constants';

export type LoginFailureReason =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'COMPANY_SUSPENDED'
  | 'COMPANY_DELETED';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string | null;
}

// Any Prisma client capable of writing userSession/loginEvent rows: the
// main PrismaService, or the interactive-transaction client passed into a
// prisma.$transaction(async (tx) => ...) callback. Mirrors
// PlatformAuditLogService's AuditLogWriter pattern — onboarding needs the
// session it creates to be part of the SAME transaction as the
// company/admin it just created, so a failure anywhere rolls back all of
// it together, never leaving an orphaned "successful login" audit trail
// for a company that doesn't exist.
type SessionWriter = Pick<PrismaService, 'userSession' | 'loginEvent'>;

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  // Creates or reactivates the single UserSession row for this
  // (userId, deviceIdHash) pair — logging in again from an already-
  // recognized browser never creates a duplicate device. A previously
  // LOGGED_OUT or REVOKED session is legitimately reactivated here: valid
  // credentials at login time are exactly what "log back in on this
  // device" means.
  async recordLoginSuccess(
    params: {
      user: SessionUser;
      context: SessionRequestContext;
    },
    writer: SessionWriter = this.prisma,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = generateOpaqueToken();
    const refreshTokenHash = hashToken(refreshToken);
    const now = new Date();
    const { user, context } = params;

    const session = await writer.userSession.upsert({
      where: { userId_deviceIdHash: { userId: user.id, deviceIdHash: context.deviceIdHash } },
      create: {
        userId: user.id,
        companyId: user.companyId,
        deviceIdHash: context.deviceIdHash,
        refreshTokenHash,
        ipPreview: context.ipPreview,
        browser: context.browser,
        operatingSystem: context.operatingSystem,
        deviceType: context.deviceType,
        firstSeenAt: now,
        lastSeenAt: now,
        lastLoginAt: now,
        lastActivityAt: now,
      },
      update: {
        refreshTokenHash,
        companyId: user.companyId,
        ipPreview: context.ipPreview,
        browser: context.browser,
        operatingSystem: context.operatingSystem,
        deviceType: context.deviceType,
        status: 'ACTIVE',
        lastSeenAt: now,
        lastLoginAt: now,
        lastActivityAt: now,
        loggedOutAt: null,
        revokedAt: null,
        revokedByUserId: null,
      },
      select: { id: true },
    });

    await writer.loginEvent.create({
      data: {
        userId: user.id,
        companyId: user.companyId,
        emailAttempted: user.email,
        status: 'SUCCESS',
        deviceIdHash: context.deviceIdHash,
        ipPreview: context.ipPreview,
        browser: context.browser,
        operatingSystem: context.operatingSystem,
        deviceType: context.deviceType,
      },
    });

    return { sessionId: session.id, refreshToken };
  }

  // Never includes the password or any token. `emailAttempted` is stored
  // as given (lowercased/trimmed by the caller) even when it matches no
  // account — this is an internal row behind PlatformGuard, not a message
  // shown back to whoever is attempting to log in.
  async recordLoginFailure(params: {
    emailAttempted: string;
    userId?: string | null;
    companyId?: string | null;
    failureReason: LoginFailureReason;
    context: SessionRequestContext;
  }): Promise<void> {
    const { context } = params;
    await this.prisma.loginEvent.create({
      data: {
        userId: params.userId ?? null,
        companyId: params.companyId ?? null,
        emailAttempted: params.emailAttempted,
        status: 'FAILED',
        failureReason: params.failureReason,
        deviceIdHash: context.deviceIdHash,
        ipPreview: context.ipPreview,
        browser: context.browser,
        operatingSystem: context.operatingSystem,
        deviceType: context.deviceType,
      },
    });
  }

  // Validates the opaque refresh token from the httpOnly cookie, rotates
  // it (issuing a fresh one and invalidating the old hash in the same
  // write), and returns enough of the user to mint a new access JWT.
  // Returns null for: unknown token, non-ACTIVE session, inactivity-expired
  // session, or a deactivated user — the caller treats all of these as a
  // generic 401, never distinguishing which.
  async rotateRefreshToken(
    plainToken: string,
    context: SessionRequestContext,
  ): Promise<{ sessionId: string; refreshToken: string; user: SessionUser } | null> {
    const hash = hashToken(plainToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });
    if (!session) return null;

    if (session.status === 'ACTIVE' && isSessionInactiveExpired(session.lastSeenAt)) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      return null;
    }

    if (session.status !== 'ACTIVE') return null;
    if (!session.user.isActive) return null;

    const newRefreshToken = generateOpaqueToken();
    const newHash = hashToken(newRefreshToken);
    const now = new Date();

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newHash,
        lastSeenAt: now,
        ipPreview: context.ipPreview,
        browser: context.browser,
        operatingSystem: context.operatingSystem,
        deviceType: context.deviceType,
      },
    });

    return {
      sessionId: session.id,
      refreshToken: newRefreshToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role,
        companyId: session.user.companyId,
      },
    };
  }

  // Closes only the ONE session identified by this refresh token — never
  // touches the user's other devices. Idempotent: logging out twice (or a
  // token that no longer matches an ACTIVE session) is a silent no-op.
  async closeSessionByRefreshToken(plainToken: string): Promise<void> {
    const hash = hashToken(plainToken);
    await this.prisma.userSession.updateMany({
      where: { refreshTokenHash: hash, status: 'ACTIVE' },
      data: { status: 'LOGGED_OUT', loggedOutAt: new Date() },
    });
  }

  // Raw, unthrottled write — callers (ActivityThrottleInterceptor) are
  // responsible for the "at most once per 5 minutes" gate; this method
  // just performs the single write once that gate has already passed.
  async touchActivity(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, status: 'ACTIVE' },
      data: { lastActivityAt: new Date() },
    });
  }
}
