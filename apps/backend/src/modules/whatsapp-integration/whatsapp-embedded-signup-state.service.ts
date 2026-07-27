import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

// Any Prisma client capable of writing the state row: the main PrismaService or
// an interactive-transaction client.
type StateWriter = Pick<PrismaService, 'whatsAppEmbeddedSignupState'>;

const DEFAULT_TTL_MINUTES = 10;

// Anti-CSRF / anti-replay state for the Meta Embedded Signup flow.
//
// Security model (mirrors PasswordResetToken):
//  - The plaintext state is 32 random bytes (crypto.randomBytes), hex-encoded.
//  - Only its SHA-256 hash is stored; the plaintext lives only in the browser
//    during the flow and is never persisted, logged, or returned after issue.
//  - Single-use: consumed via an atomic compare-and-swap (updateMany where
//    usedAt=null AND not expired -> count===1), so a state can never be
//    replayed or used by a second request.
//  - Bound to the company (and the issuing user) so a code obtained in one
//    tenant's session can never be completed against another tenant.
@Injectable()
export class WhatsAppEmbeddedSignupStateService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  ttlMinutes(): number {
    const raw = this.configService.get<string>(
      'WHATSAPP_EMBEDDED_SIGNUP_STATE_TTL_MINUTES',
    );
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_MINUTES;
    return parsed;
  }

  // Issues a fresh single-use state for a company, invalidating any prior
  // unused states for that company first. Returns the plaintext (to hand to
  // the browser) and the expiry. The plaintext is never stored.
  async issueForCompany(
    companyId: string,
    createdByUserId: string | null,
    requestedIpPreview: string | null,
    writer: StateWriter = this.prisma,
  ): Promise<{ state: string; expiresAt: Date }> {
    const plain = randomBytes(32).toString('hex');
    const stateHash = this.hash(plain);
    const expiresAt = new Date(Date.now() + this.ttlMinutes() * 60_000);

    // Invalidate prior unused states for this company (best-effort; a fresh
    // start supersedes any abandoned one).
    await writer.whatsAppEmbeddedSignupState.deleteMany({
      where: { companyId, usedAt: null },
    });

    await writer.whatsAppEmbeddedSignupState.create({
      data: {
        companyId,
        stateHash,
        expiresAt,
        createdByUserId,
        requestedIpPreview,
      },
    });

    return { state: plain, expiresAt };
  }

  // Atomically consumes a state for a company. Throws a generic
  // BadRequestException if the state is missing, malformed, expired, already
  // used, or belongs to a different company. Never reveals which condition
  // failed.
  async consumeForCompany(
    companyId: string,
    plainState: string,
    writer: StateWriter = this.prisma,
  ): Promise<void> {
    const stateHash = this.hash(plainState);
    const now = new Date();

    const result = await writer.whatsAppEmbeddedSignupState.updateMany({
      where: {
        stateHash,
        companyId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (result.count !== 1) {
      throw new BadRequestException(
        'La sesión de conexión con Meta expiró o no es válida. Inténtalo de nuevo.',
      );
    }
  }

  // True when the company has an active (unused, unexpired) state — i.e. a
  // connection attempt is in progress. Used only to derive a CONNECTING status.
  async hasActiveState(companyId: string): Promise<boolean> {
    const found = await this.prisma.whatsAppEmbeddedSignupState.findFirst({
      where: { companyId, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return Boolean(found);
  }

  private hash(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }
}
