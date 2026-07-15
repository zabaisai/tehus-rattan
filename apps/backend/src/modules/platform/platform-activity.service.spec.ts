import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformActivityService } from './platform-activity.service';

const actor = {
  actorUserId: 'super-admin-1',
  actorRole: 'SUPER_ADMIN' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'jest-test-agent',
};

describe('PlatformActivityService', () => {
  let prisma: any;
  let auditLogService: any;
  let service: PlatformActivityService;

  beforeEach(() => {
    prisma = {
      company: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      userSession: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      loginEvent: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((arg: any) => arg(prisma)),
    };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    service = new PlatformActivityService(prisma, auditLogService);
  });

  describe('getCompanyActivity', () => {
    it('throws NotFoundException for an unknown company', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(service.getCompanyActivity('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns hasHistoricalData: false with a clear message when the company has zero sessions and zero login events', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Acme',
      });
      prisma.userSession.count.mockResolvedValue(0);
      prisma.loginEvent.count.mockResolvedValue(0);

      const result = await service.getCompanyActivity('company-a');

      expect(result).toEqual({
        company: { id: 'company-a', name: 'Acme' },
        hasHistoricalData: false,
        message: 'Sin información histórica disponible',
      });
    });

    it('never treats a company with no history as "never logged in" — the two are different, and the fallback message says neither', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Acme',
      });
      prisma.userSession.count.mockResolvedValue(0);
      prisma.loginEvent.count.mockResolvedValue(0);

      const result = await service.getCompanyActivity('company-a');

      expect(JSON.stringify(result)).not.toMatch(/nunca/i);
    });

    it('computes usersNeverLoggedIn from users with zero sessions once real history exists', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Acme',
      });
      prisma.userSession.count.mockResolvedValue(1);
      prisma.loginEvent.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          name: 'A',
          email: 'a@co.test',
          role: 'ADMIN',
          isActive: true,
        },
        {
          id: 'user-2',
          name: 'B',
          email: 'b@co.test',
          role: 'AGENT',
          isActive: true,
        },
      ]);
      prisma.userSession.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          deviceId: 'device-1',
          status: 'ACTIVE',
          lastActivityAt: new Date(),
        },
      ]);

      const result: any = await service.getCompanyActivity('company-a');

      expect(result.hasHistoricalData).toBe(true);
      expect(result.usersNeverLoggedIn).toEqual([
        { id: 'user-2', name: 'B', email: 'b@co.test', role: 'AGENT' },
      ]);
    });
  });

  describe('listCompanySessions', () => {
    it('throws NotFoundException for an unknown company', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(service.listCompanySessions('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('never selects refreshTokenHash, deviceIdHash, raw userAgent, or a full ipAddress — only ipPreview and the parsed browser/OS/deviceType fields', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });

      await service.listCompanySessions('company-a', {});

      const findManyCall = prisma.userSession.findMany.mock.calls[0][0];
      expect(findManyCall.select.refreshTokenHash).toBeUndefined();
      expect(findManyCall.select.deviceIdHash).toBeUndefined();
      expect(findManyCall.select.userAgent).toBeUndefined();
      expect(findManyCall.select.ipAddress).toBeUndefined();
      expect(findManyCall.select.ipPreview).toBe(true);
      expect(findManyCall.select.browser).toBe(true);
      expect(findManyCall.select.operatingSystem).toBe(true);
      expect(findManyCall.select.deviceType).toBe(true);
    });

    it('rejects an invalid status filter', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });

      await expect(
        service.listCompanySessions('company-a', { status: 'BOGUS' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('paginates results', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.userSession.count.mockResolvedValue(45);

      const result = await service.listCompanySessions('company-a', {
        page: 2,
        pageSize: 20,
      });

      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.totalPages).toBe(3);
    });
  });

  describe('revokeSession', () => {
    it('revokes an ACTIVE session and audits the action', async () => {
      prisma.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'ACTIVE',
        userId: 'user-1',
        companyId: 'company-a',
        deviceId: 'device-1',
      });
      prisma.userSession.findUniqueOrThrow.mockResolvedValue({
        id: 'session-1',
        status: 'REVOKED',
      });

      await service.revokeSession('session-1', actor);

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1', status: 'ACTIVE' },
          data: expect.objectContaining({
            status: 'REVOKED',
            revokedByUserId: actor.actorUserId,
          }),
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'REVOKE_SESSION' }),
      );
    });

    it('throws NotFoundException for an unknown session', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);

      await expect(service.revokeSession('missing', actor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects revoking a session that is not ACTIVE (race or already closed)', async () => {
      prisma.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'ACTIVE',
        userId: 'user-1',
        companyId: 'company-a',
        deviceId: 'device-1',
      });
      prisma.userSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeSession('session-1', actor)).rejects.toThrow(
        'Solo se pueden revocar sesiones activas',
      );
    });
  });

  describe('revokeAllSessionsForUser', () => {
    it('revokes every ACTIVE session for the user and audits it', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        companyId: 'company-a',
      });
      prisma.userSession.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.revokeAllSessionsForUser('user-1', actor);

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'ACTIVE' },
        }),
      );
      expect(result.revokedCount).toBe(3);
      expect(auditLogService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'REVOKE_ALL_USER_SESSIONS' }),
      );
    });

    it('throws NotFoundException for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeAllSessionsForUser('missing', actor),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeAllSessionsForCompany', () => {
    it('revokes every ACTIVE session across the whole company and audits it', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'company-a' });
      prisma.userSession.updateMany.mockResolvedValue({ count: 7 });

      const result = await service.revokeAllSessionsForCompany(
        'company-a',
        actor,
      );

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-a', status: 'ACTIVE' },
        }),
      );
      expect(result.revokedCount).toBe(7);
      expect(auditLogService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'REVOKE_ALL_COMPANY_SESSIONS' }),
      );
    });

    it('throws NotFoundException for an unknown company', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeAllSessionsForCompany('missing', actor),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSummary', () => {
    it('never leaks tokens/hashes — the response is only counts', async () => {
      prisma.userSession.findMany.mockResolvedValue([]);

      const summary = await service.getSummary();

      const keys = Object.keys(summary);
      expect(keys.every((k) => !/token|hash/i.test(k))).toBe(true);
    });
  });
});
