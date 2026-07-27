import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  generateOpaqueToken,
  hashToken,
} from '../../sessions/utils/token.util';

// Per-account resend cooldown: a still-active token created within this window
// suppresses issuing another (anti email-bombing), independent of the per-IP
// throttler on the endpoint.
const RESEND_COOLDOWN_MS = 60_000;
const DEFAULT_TTL_MINUTES = 15;

@Injectable()
export class PasswordResetTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  ttlMinutes(): number {
    const raw = Number(
      this.config.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES') ??
        String(DEFAULT_TTL_MINUTES),
    );
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TTL_MINUTES;
  }

  private ttlMs(): number {
    return this.ttlMinutes() * 60_000;
  }

  // Issues a new single-use token for the user and returns the PLAINTEXT token
  // (only ever held in memory to build the emailed URL — never persisted). All
  // of the user's prior still-active tokens are invalidated in the same
  // transaction, so only the newest link works. Returns null when a token was
  // issued within the resend cooldown (the caller still returns the generic
  // response). The token itself (crypto.randomBytes) is never logged.
  async issueForUser(
    userId: string,
    requestedIpPreview: string | null,
  ): Promise<string | null> {
    const now = new Date();

    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) return null;

    const plainToken = generateOpaqueToken(32);
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(now.getTime() + this.ttlMs());

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt, requestedIpPreview },
      });
    });

    return plainToken;
  }

  // Compensating action: revoke the token we just issued because the email
  // could not be sent, so no unusable-but-live token is left behind.
  async revokeByPlainToken(plainToken: string): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash: hashToken(plainToken), usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Atomically consumes a token INSIDE the caller's transaction. Returns the
  // owning userId if THIS call won the race, else null. The conditional
  // updateMany (unused + unrevoked + unexpired, count === 1) is the
  // compare-and-swap: with two concurrent consumers of the same token, exactly
  // one gets count === 1 and the other gets 0 (Postgres row locking), so a
  // password is never changed twice by a single token.
  async consumeWithin(
    plainToken: string,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (typeof plainToken !== 'string' || plainToken.length === 0) return null;
    const tokenHash = hashToken(plainToken);

    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });
    if (!row) return null;

    const swap = await tx.passwordResetToken.updateMany({
      where: {
        id: row.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (swap.count !== 1) return null;

    return row.userId;
  }
}
