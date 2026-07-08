import 'reflect-metadata';
import { SupportSessionsController } from './support-sessions.controller';
import { PlatformGuard } from '../../common/guards/platform.guard';

const req = {
  user: { sub: 'super-admin-1', role: 'SUPER_ADMIN', companyId: null },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest-test-agent' },
};

describe('SupportSessionsController', () => {
  let service: any;
  let controller: SupportSessionsController;

  beforeEach(() => {
    service = {
      createSession: jest.fn(),
      endSession: jest.fn(),
      listSessions: jest.fn(),
      listSessionConversations: jest.fn(),
    };
    controller = new SupportSessionsController(service);
  });

  describe('POST /platform/support-sessions', () => {
    it('delegates to createSession with the actor derived from the request', async () => {
      service.createSession.mockResolvedValue({ id: 'session-1' });
      const dto = { companyId: 'company-a', reason: 'Motivo' };

      await controller.create(dto as any, req as any);

      expect(service.createSession).toHaveBeenCalledWith(
        dto,
        expect.objectContaining({
          actorUserId: 'super-admin-1',
          actorRole: 'SUPER_ADMIN',
          ipAddress: '127.0.0.1',
          userAgent: 'jest-test-agent',
        }),
      );
    });
  });

  describe('POST /platform/support-sessions/:id/end', () => {
    it('delegates to endSession with the session id and actor', async () => {
      service.endSession.mockResolvedValue({ id: 'session-1', status: 'ENDED' });

      await controller.end('session-1', req as any);

      expect(service.endSession).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ actorUserId: 'super-admin-1' }),
      );
    });
  });

  describe('GET /platform/support-sessions', () => {
    it('delegates to listSessions scoped to the actor with optional filters', async () => {
      service.listSessions.mockResolvedValue([]);

      await controller.list(req as any, 'company-a', 'ACTIVE');

      expect(service.listSessions).toHaveBeenCalledWith('super-admin-1', {
        companyId: 'company-a',
        status: 'ACTIVE',
      });
    });
  });

  describe('GET /platform/support-sessions/:id/conversations', () => {
    it('delegates to listSessionConversations with the session id, actor, and pagination', async () => {
      service.listSessionConversations.mockResolvedValue([]);

      await controller.listConversations('session-1', req as any, '2', '10');

      expect(service.listSessionConversations).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ actorUserId: 'super-admin-1' }),
        { page: '2', limit: '10' },
      );
    });
  });

  describe('guards', () => {
    it('applies exactly 2 class-level guards, the second being PlatformGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        SupportSessionsController,
      );

      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(PlatformGuard);
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(PlatformGuard);
    });
  });
});
