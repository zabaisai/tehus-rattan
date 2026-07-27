// Shared by every guard-focused e2e spec that signs its own JWTs and needs
// JwtStrategy's new sid/UserSession lookup (see jwt.strategy.ts) to resolve
// to a plausible ACTIVE session, without each spec file having to hand-roll
// its own PrismaService mock. This is deliberately generic and stateless:
// the "session" is derived entirely from the sid itself (see encodeSid), so
// any test that signs a token via encodeSid(userId, companyId) gets a
// consistent, matching ACTIVE session back with zero extra setup.
export function buildFakeSessionPrisma() {
  return {
    userSession: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const [userId, companyId] = where.id.split('::');
        if (!userId) return null;
        return {
          userId,
          companyId: companyId === 'null' ? null : companyId,
          status: 'ACTIVE',
          revokedAt: null,
          loggedOutAt: null,
          lastSeenAt: new Date(),
        };
      }),
    },
  };
}

// Encodes just enough into the sid for buildFakeSessionPrisma's mock to
// answer consistently — these e2e specs are testing guards/roles, not
// UserSession persistence itself (see jwt.strategy.spec.ts and
// session-revocation.e2e-spec.ts for that).
export function encodeSid(userId: string, companyId: string | null): string {
  return `${userId}::${companyId ?? 'null'}`;
}
