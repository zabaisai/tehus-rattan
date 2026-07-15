import { SessionsService, SessionUser } from './sessions.service';
import { SessionRequestContext } from './utils/request-context.util';
import { hashToken } from './utils/token.util';

const baseUser: SessionUser = {
  id: 'user-1',
  email: 'admin@company-a.test',
  name: 'Admin A',
  role: 'ADMIN',
  companyId: 'company-a',
};

function buildContext(overrides: Partial<SessionRequestContext> = {}): SessionRequestContext {
  return {
    deviceId: 'device-1',
    ipAddress: '181.60.12.24',
    ipPreview: '181.***.***.24',
    userAgent: 'jest-test-agent',
    browser: 'Chrome 120',
    operatingSystem: 'Windows 10',
    deviceType: 'DESKTOP',
    ...overrides,
  };
}

describe('SessionsService', () => {
  let prisma: any;
  let service: SessionsService;
  let sessionsStore: Map<string, any>;
  let idCounter: number;

  beforeEach(() => {
    idCounter = 0;
    sessionsStore = new Map();

    prisma = {
      userSession: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const key = `${where.userId_deviceId.userId}:${where.userId_deviceId.deviceId}`;
          const existing = sessionsStore.get(key);
          if (existing) {
            const merged = { ...existing, ...update };
            sessionsStore.set(key, merged);
            return { id: existing.id };
          }
          const id = `session-${++idCounter}`;
          // Mirrors the schema's `status UserSessionStatus @default(ACTIVE)`
          // — the real service relies on that DB default rather than
          // setting it explicitly, so this mock must apply it too.
          const created = {
            id,
            userId: where.userId_deviceId.userId,
            deviceId: where.userId_deviceId.deviceId,
            status: 'ACTIVE',
            ...create,
          };
          sessionsStore.set(key, created);
          return { id };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.refreshTokenHash) {
            const found = Array.from(sessionsStore.values()).find(
              (s) => s.refreshTokenHash === where.refreshTokenHash,
            );
            if (!found) return null;
            return { ...found, user: { ...baseUser, isActive: true } };
          }
          return null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const entry = Array.from(sessionsStore.entries()).find(([, s]) => s.id === where.id);
          if (entry) sessionsStore.set(entry[0], { ...entry[1], ...data });
          return entry?.[1];
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const [key, s] of sessionsStore.entries()) {
            if (where.id && s.id !== where.id) continue;
            if (where.refreshTokenHash && s.refreshTokenHash !== where.refreshTokenHash) continue;
            if (where.status && s.status !== where.status) continue;
            sessionsStore.set(key, { ...s, ...data });
            count++;
          }
          return { count };
        }),
      },
      loginEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    service = new SessionsService(prisma);
  });

  describe('recordLoginSuccess', () => {
    it('creates a new ACTIVE UserSession and a SUCCESS LoginEvent', async () => {
      const context = buildContext();

      const result = await service.recordLoginSuccess({ user: baseUser, context });

      expect(result.sessionId).toBeDefined();
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.loginEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
      );
    });

    it('never stores the plaintext refresh token — only its hash', async () => {
      const context = buildContext();

      const result = await service.recordLoginSuccess({ user: baseUser, context });

      const stored = sessionsStore.get('user-1:device-1');
      expect(stored.refreshTokenHash).toBe(hashToken(result.refreshToken));
      expect(stored.refreshTokenHash).not.toBe(result.refreshToken);
      expect(JSON.stringify(stored)).not.toContain(result.refreshToken);
    });

    it('recognizes the same browser: logging in again from the same deviceId updates the same session row, not a new one', async () => {
      const context = buildContext();

      const first = await service.recordLoginSuccess({ user: baseUser, context });
      const second = await service.recordLoginSuccess({ user: baseUser, context });

      expect(second.sessionId).toBe(first.sessionId);
      expect(sessionsStore.size).toBe(1);
    });

    it('creates two separate sessions (two recognized devices) for two different deviceIds of the same user', async () => {
      await service.recordLoginSuccess({ user: baseUser, context: buildContext({ deviceId: 'device-A' }) });
      await service.recordLoginSuccess({ user: baseUser, context: buildContext({ deviceId: 'device-B' }) });

      expect(sessionsStore.size).toBe(2);
      const deviceIds = Array.from(sessionsStore.values()).map((s) => s.deviceId);
      expect(new Set(deviceIds).size).toBe(2);
    });

    it('keeps the same device as one session even when its IP address changes between logins', async () => {
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceId: 'device-1', ipAddress: '181.60.12.24' }),
      });
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceId: 'device-1', ipAddress: '200.10.5.9' }),
      });

      expect(sessionsStore.size).toBe(1);
      const stored = sessionsStore.get('user-1:device-1');
      expect(stored.ipAddress).toBe('200.10.5.9');
    });

    it('does not count two different users behind the same IP as one device', async () => {
      const userTwo: SessionUser = { ...baseUser, id: 'user-2', email: 'agent@company-a.test' };

      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceId: 'device-shared-ip-1', ipAddress: '190.1.1.1' }),
      });
      await service.recordLoginSuccess({
        user: userTwo,
        context: buildContext({ deviceId: 'device-shared-ip-2', ipAddress: '190.1.1.1' }),
      });

      expect(sessionsStore.size).toBe(2);
      const userIds = Array.from(sessionsStore.values()).map((s) => s.userId);
      expect(new Set(userIds)).toEqual(new Set(['user-1', 'user-2']));
    });
  });

  describe('rotateRefreshToken', () => {
    it('returns null and never rotates a REVOKED session — it cannot be renewed', async () => {
      const { refreshToken } = await service.recordLoginSuccess({ user: baseUser, context: buildContext() });
      const stored = sessionsStore.get('user-1:device-1');
      sessionsStore.set('user-1:device-1', { ...stored, status: 'REVOKED' });

      const result = await service.rotateRefreshToken(refreshToken, buildContext());

      expect(result).toBeNull();
    });

    it('rotates an ACTIVE session and invalidates the previous refresh token', async () => {
      const { refreshToken } = await service.recordLoginSuccess({ user: baseUser, context: buildContext() });

      const rotated = await service.rotateRefreshToken(refreshToken, buildContext());

      expect(rotated).not.toBeNull();
      expect(rotated!.refreshToken).not.toBe(refreshToken);

      // The old plaintext token no longer matches anything.
      const reuseAttempt = await service.rotateRefreshToken(refreshToken, buildContext());
      expect(reuseAttempt).toBeNull();
    });

    it('returns null for a completely unknown token', async () => {
      const result = await service.rotateRefreshToken('never-issued-token', buildContext());
      expect(result).toBeNull();
    });
  });

  describe('closeSessionByRefreshToken (logout)', () => {
    it('closes only the one session matching the given refresh token, not the user\'s other devices', async () => {
      const sessionA = await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceId: 'device-A' }),
      });
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceId: 'device-B' }),
      });

      await service.closeSessionByRefreshToken(sessionA.refreshToken);

      expect(sessionsStore.get('user-1:device-A').status).toBe('LOGGED_OUT');
      expect(sessionsStore.get('user-1:device-B').status).toBe('ACTIVE');
    });

    it('is a silent no-op for an unknown token', async () => {
      await expect(service.closeSessionByRefreshToken('unknown')).resolves.not.toThrow();
    });
  });
});
