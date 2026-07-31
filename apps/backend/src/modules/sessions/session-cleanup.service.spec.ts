import { SessionCleanupService } from './session-cleanup.service';
import {
  CLOSED_SESSION_RETENTION_DAYS,
  LOGIN_EVENT_RETENTION_DAYS,
} from './sessions.constants';

// Los trabajos programados corren en UN SOLO proceso (ver
// common/scheduling/scheduling.role.ts). Se declara el entorno aqui en vez de
// depender de como se invoque la suite: una prueba que pasa o falla segun el
// entorno de quien la lanza no prueba nada.
const colaOriginal = process.env.QUEUE_ENABLED;
beforeAll(() => {
  process.env.QUEUE_ENABLED = 'false';
});
afterAll(() => {
  if (colaOriginal === undefined) delete process.env.QUEUE_ENABLED;
  else process.env.QUEUE_ENABLED = colaOriginal;
});


describe('SessionCleanupService', () => {
  let prisma: any;
  let service: SessionCleanupService;

  beforeEach(() => {
    prisma = {
      loginEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    service = new SessionCleanupService(prisma);
  });

  describe('cleanupExpiredLoginEvents', () => {
    it(`deletes only LoginEvent rows older than ${LOGIN_EVENT_RETENTION_DAYS} days`, async () => {
      await service.cleanupExpiredLoginEvents();

      const call = prisma.loginEvent.deleteMany.mock.calls[0][0];
      const cutoff = call.where.createdAt.lt as Date;
      const expectedCutoff =
        Date.now() - LOGIN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
    });

    it('never touches sessions', async () => {
      await service.cleanupExpiredLoginEvents();
      expect(prisma.userSession.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('cleanupClosedSessions', () => {
    it('only targets LOGGED_OUT, REVOKED, or EXPIRED sessions — never ACTIVE ones', async () => {
      await service.cleanupClosedSessions();

      const call = prisma.userSession.deleteMany.mock.calls[0][0];
      expect(call.where.status.in).toEqual([
        'LOGGED_OUT',
        'REVOKED',
        'EXPIRED',
      ]);
      expect(call.where.status.in).not.toContain('ACTIVE');
    });

    it(`uses a ${CLOSED_SESSION_RETENTION_DAYS}-day retention cutoff`, async () => {
      await service.cleanupClosedSessions();

      const call = prisma.userSession.deleteMany.mock.calls[0][0];
      const cutoff = call.where.OR[0].loggedOutAt.lt as Date;
      const expectedCutoff =
        Date.now() - CLOSED_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
    });
  });

  describe('handleScheduledCleanup', () => {
    it('runs both cleanup steps', async () => {
      const loginSpy = jest.spyOn(service, 'cleanupExpiredLoginEvents');
      const sessionSpy = jest.spyOn(service, 'cleanupClosedSessions');

      await service.handleScheduledCleanup();

      expect(loginSpy).toHaveBeenCalled();
      expect(sessionSpy).toHaveBeenCalled();
    });
  });
});
