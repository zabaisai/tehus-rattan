import { PrismaService } from '../src/prisma/prisma.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { hashToken } from '../src/modules/sessions/utils/token.util';
import type { SessionRequestContext } from '../src/modules/sessions/utils/request-context.util';

// Real Postgres concurrency test (same pattern as leads-history.e2e-spec.ts).
// Proves the compare-and-swap rotation is atomic under genuine DB concurrency:
// two refreshes with the SAME token fired in parallel resolve to exactly one
// winner, the loser gets null, and the stored hash matches only the winner —
// so the browser cookie can never desync from the DB. Requires
// `docker-compose up -d postgres` with migrations applied. No external calls.
describe('Refresh token rotation concurrency (e2e, real database)', () => {
  let prisma: PrismaService;
  let service: SessionsService;
  const stamp = Date.now();

  let userId: string;
  let sessionId: string;
  const plainToken = `e2e-concurrency-token-${stamp}`;

  const ctx: SessionRequestContext = {
    deviceIdHash: `e2e-dev-${stamp}`,
    ipPreview: '190.1.1.0',
    browser: 'Chrome 120',
    operatingSystem: 'Windows 10',
    deviceType: 'DESKTOP',
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SessionsService(prisma);

    const user = await prisma.user.create({
      data: {
        email: `e2e-rotation-${stamp}@test.local`,
        password: 'unused-hash',
        name: 'E2E Rotation User',
        role: 'AGENT',
        isActive: true,
      },
    });
    userId = user.id;

    const session = await prisma.userSession.create({
      data: {
        userId,
        deviceIdHash: ctx.deviceIdHash,
        refreshTokenHash: hashToken(plainToken),
        status: 'ACTIVE',
        ipPreview: ctx.ipPreview,
        browser: ctx.browser,
        operatingSystem: ctx.operatingSystem,
        deviceType: ctx.deviceType,
      },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('exactly one of two concurrent rotations with the same token wins; the other is null', async () => {
    const [a, b] = await Promise.all([
      service.rotateRefreshToken(plainToken, ctx),
      service.rotateRefreshToken(plainToken, ctx),
    ]);

    const winners = [a, b].filter(Boolean);
    const losers = [a, b].filter((x) => x === null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // The stored hash matches ONLY the winner's new token; the session is
    // still ACTIVE (never revoked or corrupted by the race).
    const stored = await prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    expect(stored?.refreshTokenHash).toBe(hashToken(winners[0]!.refreshToken));
    expect(stored?.refreshTokenHash).not.toBe(hashToken(plainToken));
    expect(stored?.status).toBe('ACTIVE');

    // The original token is now invalid; the winner's new token still rotates.
    expect(await service.rotateRefreshToken(plainToken, ctx)).toBeNull();
    const again = await service.rotateRefreshToken(
      winners[0]!.refreshToken,
      ctx,
    );
    expect(again).not.toBeNull();
  });
});
