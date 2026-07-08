import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SupportSessionsService } from './support-sessions.service';
import { PlatformAuditLogService } from './platform-audit-log.service';

const actor = {
  actorUserId: 'super-admin-1',
  actorRole: 'SUPER_ADMIN' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'jest-test-agent',
};

const validDto = {
  companyId: 'company-a',
  reason: 'Cliente pidió soporte para revisar un caso puntual',
};

describe('SupportSessionsService', () => {
  let prisma: any;
  let auditLogService: PlatformAuditLogService;
  let service: SupportSessionsService;

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn(),
      },
      supportSession: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      conversation: {
        findMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<any>) =>
        callback(prisma),
      ),
    };
    auditLogService = new PlatformAuditLogService(prisma);
    service = new SupportSessionsService(prisma, auditLogService);
  });

  describe('createSession', () => {
    function stubHappyPath() {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'ACTIVE',
      });
      prisma.supportSession.findFirst.mockResolvedValue(null);
      prisma.supportSession.create.mockImplementation(async ({ data }: any) => ({
        id: 'session-1',
        actorUserId: data.actorUserId,
        companyId: data.companyId,
        reason: data.reason,
        status: 'ACTIVE',
        expiresAt: data.expiresAt,
        endedAt: null,
        createdAt: new Date('2026-07-08T12:00:00.000Z'),
        company: { id: 'company-a', name: 'Company A', status: 'ACTIVE' },
      }));
    }

    it('creates a support session with the required reason', async () => {
      stubHappyPath();

      const result = await service.createSession(validDto, actor);

      expect(prisma.supportSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: actor.actorUserId,
            companyId: 'company-a',
            reason: validDto.reason,
          }),
        }),
      );
      expect(result.reason).toBe(validDto.reason);
      expect(result.status).toBe('ACTIVE');
    });

    it('rejects an empty reason', async () => {
      await expect(
        service.createSession({ ...validDto, reason: '   ' }, actor),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a reason longer than 500 characters', async () => {
      await expect(
        service.createSession(
          { ...validDto, reason: 'a'.repeat(501) },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a company that does not exist', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(service.createSession(validDto, actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.supportSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.supportSession.create).not.toHaveBeenCalled();
    });

    it('rejects a DELETED company', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'DELETED',
      });

      await expect(service.createSession(validDto, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.supportSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.supportSession.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate non-expired ACTIVE session for the same actor and company', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'ACTIVE',
      });
      prisma.supportSession.findFirst.mockResolvedValue({ id: 'session-old' });

      await expect(service.createSession(validDto, actor)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.supportSession.create).not.toHaveBeenCalled();
    });

    it('allows a new session when the previous one is ENDED (excluded by the ACTIVE filter)', async () => {
      stubHappyPath();
      // The findFirst mock only matches status: 'ACTIVE' in the real query,
      // so returning null here simulates an ENDED prior session correctly
      // being excluded from the duplicate check.

      const result = await service.createSession(validDto, actor);

      expect(result.id).toBe('session-1');
    });

    it('computes expiresAt 30 minutes from now', async () => {
      stubHappyPath();
      const before = Date.now();

      await service.createSession(validDto, actor);

      const after = Date.now();
      const createCall = prisma.supportSession.create.mock.calls[0][0];
      const expiresAtMs = createCall.data.expiresAt.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 30 * 60 * 1000);
    });

    it('records a START_SUPPORT_SESSION audit log', async () => {
      stubHappyPath();

      await service.createSession(validDto, actor);

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditCall.action).toBe('START_SUPPORT_SESSION');
      expect(auditCall.entityType).toBe('SupportSession');
      expect(auditCall.entityId).toBe('session-1');
      expect(auditCall.affectedCompanyId).toBe('company-a');
      expect(auditCall.metadata).toEqual(
        expect.objectContaining({
          supportSessionId: 'session-1',
          companyId: 'company-a',
          companyName: 'Company A',
          reason: validDto.reason,
        }),
      );
    });

    it('does not create the session if writing the audit log fails', async () => {
      stubHappyPath();
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      prisma.$transaction.mockImplementation(
        async (callback: (tx: any) => Promise<any>) => callback(prisma),
      );

      await expect(service.createSession(validDto, actor)).rejects.toThrow();
    });
  });

  describe('endSession', () => {
    const activeSession = {
      id: 'session-1',
      actorUserId: actor.actorUserId,
      companyId: 'company-a',
      reason: 'Motivo',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      endedAt: null,
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
      company: { id: 'company-a', name: 'Company A', status: 'ACTIVE' },
    };

    it('closes an owned session and records END_SUPPORT_SESSION', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.supportSession.update.mockImplementation(async ({ data }: any) => ({
        ...activeSession,
        status: data.status,
        endedAt: data.endedAt,
      }));

      const result = await service.endSession('session-1', actor);

      expect(prisma.supportSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({ status: 'ENDED' }),
        }),
      );
      expect(result.status).toBe('ENDED');
      expect(result.endedAt).toBeInstanceOf(Date);

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditCall.action).toBe('END_SUPPORT_SESSION');
      expect(auditCall.affectedCompanyId).toBe('company-a');
      expect(auditCall.metadata).toEqual(
        expect.objectContaining({
          supportSessionId: 'session-1',
          companyId: 'company-a',
          companyName: 'Company A',
          durationSeconds: expect.any(Number),
        }),
      );
    });

    it('rejects closing a session owned by another actor with NotFoundException', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        ...activeSession,
        actorUserId: 'other-actor',
      });

      await expect(service.endSession('session-1', actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.supportSession.update).not.toHaveBeenCalled();
    });
  });

  describe('validateActiveSupportSession', () => {
    it('allows a non-expired ACTIVE session', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        id: 'session-1',
        actorUserId: actor.actorUserId,
        companyId: 'company-a',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const result = await service.validateActiveSupportSession(
        'session-1',
        actor.actorUserId,
      );

      expect(result.companyId).toBe('company-a');
    });

    it('rejects an ENDED session', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        id: 'session-1',
        actorUserId: actor.actorUserId,
        companyId: 'company-a',
        status: 'ENDED',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      await expect(
        service.validateActiveSupportSession('session-1', actor.actorUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an expired session', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        id: 'session-1',
        actorUserId: actor.actorUserId,
        companyId: 'company-a',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.validateActiveSupportSession('session-1', actor.actorUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listSessionConversations', () => {
    const activeSession = {
      id: 'session-1',
      actorUserId: actor.actorUserId,
      companyId: 'company-a',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      company: { id: 'company-a', name: 'Company A' },
    };

    const rawConversation = {
      id: 'conv-1',
      status: 'OPEN',
      channel: 'whatsapp',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      contact: { id: 'contact-1', name: 'Jane Doe' },
      agent: { id: 'user-1', name: 'Agent A' },
    };

    it('lists conversations when the SupportSession is ACTIVE and not expired', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([rawConversation]);

      const result = await service.listSessionConversations(
        'session-1',
        actor,
      );

      expect(result).toEqual([
        {
          id: 'conv-1',
          status: 'OPEN',
          channel: 'whatsapp',
          createdAt: rawConversation.createdAt,
          updatedAt: rawConversation.updatedAt,
          contact: { id: 'contact-1', name: 'Jane Doe' },
          assignedUser: { id: 'user-1', name: 'Agent A' },
        },
      ]);
    });

    it('rejects when the session is ENDED', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        ...activeSession,
        status: 'ENDED',
      });

      await expect(
        service.listSessionConversations('session-1', actor),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    it('rejects when the session is expired', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.listSessionConversations('session-1', actor),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    it('rejects when the session belongs to another actor', async () => {
      prisma.supportSession.findUnique.mockResolvedValue({
        ...activeSession,
        actorUserId: 'other-actor',
      });

      await expect(
        service.listSessionConversations('session-1', actor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    it("filters conversations by the session's companyId", async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([]);

      await service.listSessionConversations('session-1', actor);

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-a' },
        }),
      );
    });

    it('limits results according to the limit filter', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([]);

      await service.listSessionConversations('session-1', actor, {
        page: '2',
        limit: '5',
      });

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('rejects a limit above 50', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);

      await expect(
        service.listSessionConversations('session-1', actor, {
          limit: '51',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    it('never returns messages', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([rawConversation]);

      const result = await service.listSessionConversations(
        'session-1',
        actor,
      );

      expect(JSON.stringify(result)).not.toContain('"messages"');
      result.forEach((item: any) => {
        expect(item).not.toHaveProperty('messages');
        expect(item).not.toHaveProperty('lastMessage');
      });
    });

    it('never returns notes', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([rawConversation]);

      const result = await service.listSessionConversations(
        'session-1',
        actor,
      );

      expect(JSON.stringify(result)).not.toContain('"notes"');
      result.forEach((item: any) => {
        expect(item).not.toHaveProperty('notes');
      });
    });

    it('never returns passwords, hashes, tokens, or accessTokenEncrypted', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([rawConversation]);

      const result = await service.listSessionConversations(
        'session-1',
        actor,
      );

      const serialized = JSON.stringify(result).toLowerCase();
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('hash');
      expect(serialized).not.toContain('accesstokenencrypted');
      expect(serialized).not.toContain('"token"');
    });

    it('records a VIEW_SUPPORT_CONVERSATIONS audit log with safe metadata', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([rawConversation]);

      await service.listSessionConversations('session-1', actor);

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditCall.action).toBe('VIEW_SUPPORT_CONVERSATIONS');
      expect(auditCall.entityType).toBe('SupportSession');
      expect(auditCall.entityId).toBe('session-1');
      expect(auditCall.affectedCompanyId).toBe('company-a');
      expect(auditCall.metadata).toEqual({
        supportSessionId: 'session-1',
        companyId: 'company-a',
        companyName: 'Company A',
        resultCount: 1,
        page: 1,
        limit: 20,
      });
    });

    it('fails the request if writing the audit log fails, and never returns data', async () => {
      prisma.supportSession.findUnique.mockResolvedValue(activeSession);
      prisma.conversation.findMany.mockResolvedValue([rawConversation]);
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.listSessionConversations('session-1', actor),
      ).rejects.toThrow();
    });
  });

  describe('safe responses', () => {
    it('never includes passwords, tokens, or accessTokenEncrypted', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'ACTIVE',
      });
      prisma.supportSession.findFirst.mockResolvedValue(null);
      prisma.supportSession.create.mockResolvedValue({
        id: 'session-1',
        actorUserId: actor.actorUserId,
        companyId: 'company-a',
        reason: validDto.reason,
        status: 'ACTIVE',
        expiresAt: new Date(),
        endedAt: null,
        createdAt: new Date(),
        company: { id: 'company-a', name: 'Company A', status: 'ACTIVE' },
      });

      const created = await service.createSession(validDto, actor);
      prisma.supportSession.findMany.mockResolvedValue([
        {
          ...created,
          company: { id: 'company-a', name: 'Company A', status: 'ACTIVE' },
        },
      ]);
      const listed = await service.listSessions(actor.actorUserId);

      const serialized = JSON.stringify({ created, listed });
      expect(serialized.toLowerCase()).not.toContain('password');
      expect(serialized.toLowerCase()).not.toContain('accesstokenencrypted');
      expect(serialized.toLowerCase()).not.toContain('"token"');
    });
  });
});
