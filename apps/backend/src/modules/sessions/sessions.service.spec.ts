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
    deviceIdHash: 'device-1-hash',
    ipPreview: '181.60.12.0',
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
          const key = `${where.userId_deviceIdHash.userId}:${where.userId_deviceIdHash.deviceIdHash}`;
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
            userId: where.userId_deviceIdHash.userId,
            deviceIdHash: where.userId_deviceIdHash.deviceIdHash,
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

      const stored = sessionsStore.get('user-1:device-1-hash');
      expect(stored.refreshTokenHash).toBe(hashToken(result.refreshToken));
      expect(stored.refreshTokenHash).not.toBe(result.refreshToken);
      expect(JSON.stringify(stored)).not.toContain(result.refreshToken);
    });

    it('never persists a raw deviceId, only the hash it was given', async () => {
      const context = buildContext({ deviceIdHash: hashToken('raw-cookie-value') });

      await service.recordLoginSuccess({ user: baseUser, context });

      const stored = sessionsStore.get(`user-1:${hashToken('raw-cookie-value')}`);
      expect(stored.deviceIdHash).toBe(hashToken('raw-cookie-value'));
      expect(JSON.stringify(stored)).not.toContain('raw-cookie-value');
    });

    it('never persists a raw IP or user agent — only ipPreview and the parsed fields', async () => {
      const context = buildContext();

      await service.recordLoginSuccess({ user: baseUser, context });

      const stored = sessionsStore.get('user-1:device-1-hash');
      expect(stored.ipAddress).toBeUndefined();
      expect(stored.userAgent).toBeUndefined();
      expect(stored.ipPreview).toBe('181.60.12.0');
    });

    it('recognizes the same browser: logging in again from the same deviceIdHash updates the same session row, not a new one', async () => {
      const context = buildContext();

      const first = await service.recordLoginSuccess({ user: baseUser, context });
      const second = await service.recordLoginSuccess({ user: baseUser, context });

      expect(second.sessionId).toBe(first.sessionId);
      expect(sessionsStore.size).toBe(1);
    });

    it('creates two separate sessions (two recognized devices) for two different deviceIdHash values of the same user', async () => {
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'device-A-hash' }),
      });
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'device-B-hash' }),
      });

      expect(sessionsStore.size).toBe(2);
      const deviceHashes = Array.from(sessionsStore.values()).map((s) => s.deviceIdHash);
      expect(new Set(deviceHashes).size).toBe(2);
    });

    it('keeps the same device as one session even when its IP changes between logins', async () => {
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'device-1-hash', ipPreview: '181.60.12.0' }),
      });
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'device-1-hash', ipPreview: '200.10.5.0' }),
      });

      expect(sessionsStore.size).toBe(1);
      const stored = sessionsStore.get('user-1:device-1-hash');
      expect(stored.ipPreview).toBe('200.10.5.0');
    });

    it('does not count two different users behind the same IP as one device', async () => {
      const userTwo: SessionUser = { ...baseUser, id: 'user-2', email: 'agent@company-a.test' };

      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'device-shared-ip-1', ipPreview: '190.1.1.0' }),
      });
      await service.recordLoginSuccess({
        user: userTwo,
        context: buildContext({ deviceIdHash: 'device-shared-ip-2', ipPreview: '190.1.1.0' }),
      });

      expect(sessionsStore.size).toBe(2);
      const userIds = Array.from(sessionsStore.values()).map((s) => s.userId);
      expect(new Set(userIds)).toEqual(new Set(['user-1', 'user-2']));
    });

    it('the same deviceIdHash from a different IP is still recognized as the same device', async () => {
      const first = await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'stable-device-hash', ipPreview: '181.60.12.0' }),
      });
      const second = await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'stable-device-hash', ipPreview: '9.9.9.0' }),
      });

      expect(second.sessionId).toBe(first.sessionId);
      expect(sessionsStore.size).toBe(1);
    });
  });

  describe('rotateRefreshToken', () => {
    it('returns null and never rotates a REVOKED session — it cannot be renewed', async () => {
      const { refreshToken } = await service.recordLoginSuccess({ user: baseUser, context: buildContext() });
      const stored = sessionsStore.get('user-1:device-1-hash');
      sessionsStore.set('user-1:device-1-hash', { ...stored, status: 'REVOKED' });

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
        context: buildContext({ deviceIdHash: 'device-A-hash' }),
      });
      await service.recordLoginSuccess({
        user: baseUser,
        context: buildContext({ deviceIdHash: 'device-B-hash' }),
      });

      await service.closeSessionByRefreshToken(sessionA.refreshToken);

      expect(sessionsStore.get('user-1:device-A-hash').status).toBe('LOGGED_OUT');
      expect(sessionsStore.get('user-1:device-B-hash').status).toBe('ACTIVE');
    });

    it('is a silent no-op for an unknown token', async () => {
      await expect(service.closeSessionByRefreshToken('unknown')).resolves.not.toThrow();
    });
  });
});
