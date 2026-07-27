import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

function buildConfigService() {
  return { getOrThrow: jest.fn().mockReturnValue('test-jwt-secret') } as any;
}

const basePayload = {
  sub: 'user-1',
  email: 'admin@company-a.test',
  role: 'ADMIN',
  companyId: 'company-a',
  sid: 'session-1',
};

const activeSession = {
  userId: 'user-1',
  companyId: 'company-a',
  status: 'ACTIVE',
  revokedAt: null,
  loggedOutAt: null,
  lastSeenAt: new Date(),
};

describe('JwtStrategy', () => {
  let prisma: any;
  let strategy: JwtStrategy;

  beforeEach(() => {
    prisma = {
      userSession: { findUnique: jest.fn() },
    };
    strategy = new JwtStrategy(buildConfigService(), prisma);
  });

  // #2 — a token whose session is ACTIVE, correctly owned, and current works.
  it('accepts a token whose session is ACTIVE and returns the request-user shape', async () => {
    prisma.userSession.findUnique.mockResolvedValue(activeSession);

    const result = await strategy.validate(basePayload);

    expect(result).toEqual({
      sub: 'user-1',
      email: 'admin@company-a.test',
      role: 'ADMIN',
      companyId: 'company-a',
      sid: 'session-1',
    });
    expect(prisma.userSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-1' } }),
    );
  });

  // #3 — no legacy/back-compat exception: a token with no sid at all is
  // rejected outright, before any DB lookup even happens.
  it('rejects a token with no sid at all, with 401, before touching the database', async () => {
    const { sid, ...payloadWithoutSid } = basePayload;
    void sid;

    await expect(strategy.validate(payloadWithoutSid)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  // #4
  it('rejects a token whose sid matches no UserSession row', async () => {
    prisma.userSession.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // #5 — the whole point of this feature: revoking must be immediate.
  it('rejects a token whose session is REVOKED — immediately, not waiting for the token to expire', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      status: 'REVOKED',
      revokedAt: new Date(),
    });

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // #6
  it('rejects a token whose session is LOGGED_OUT — immediately', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      status: 'LOGGED_OUT',
      loggedOutAt: new Date(),
    });

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // #7
  it('rejects a token whose session is EXPIRED', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      status: 'EXPIRED',
    });

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose session is nominally ACTIVE but has been inactive past the 90-day threshold', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      status: 'ACTIVE',
      lastSeenAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
    });

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // #8 — sid stolen/reused against a different user's token.
  it('rejects when the session belongs to a different user than the token claims', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      userId: 'someone-else',
    });

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // #9
  it('rejects when the session belongs to a different company than the token claims', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      companyId: 'company-b',
    });

    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('treats a SUPER_ADMIN token (companyId null) correctly — null must match null, not be treated as "any company"', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      companyId: null,
    });

    await expect(
      strategy.validate({ ...basePayload, companyId: null }),
    ).resolves.toBeDefined();

    // A null-companyId session must still fail for a payload claiming a
    // real company — nulls are not a wildcard in either direction.
    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      companyId: null,
    });
    await expect(strategy.validate(basePayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects every failure with the same generic message, never revealing which check failed', async () => {
    prisma.userSession.findUnique.mockResolvedValue(null);
    let unknownSidError: string | undefined;
    try {
      await strategy.validate(basePayload);
    } catch (err) {
      unknownSidError = err instanceof Error ? err.message : undefined;
    }

    prisma.userSession.findUnique.mockResolvedValue({
      ...activeSession,
      status: 'REVOKED',
    });
    let revokedError: string | undefined;
    try {
      await strategy.validate(basePayload);
    } catch (err) {
      revokedError = err instanceof Error ? err.message : undefined;
    }

    expect(unknownSidError).toBe(revokedError);
  });
});
