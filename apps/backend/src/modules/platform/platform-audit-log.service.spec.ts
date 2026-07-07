import { InternalServerErrorException } from '@nestjs/common';
import { PlatformAuditLogService } from './platform-audit-log.service';

describe('PlatformAuditLogService', () => {
  let prisma: any;
  let service: PlatformAuditLogService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new PlatformAuditLogService(prisma);
  });

  describe('record', () => {
    const input = {
      actorUserId: 'super-admin-1',
      actorRole: 'SUPER_ADMIN' as const,
      affectedCompanyId: 'company-a',
      action: 'CREATE_COMPANY',
      entityType: 'Company',
      entityId: 'company-a',
      metadata: { companyName: 'Company A' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest-test-agent',
    };

    it('writes the row through the given writer (works for a transaction client too)', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      await service.record(prisma, input);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'super-admin-1',
          actorRole: 'SUPER_ADMIN',
          affectedCompanyId: 'company-a',
          action: 'CREATE_COMPANY',
          entityType: 'Company',
          entityId: 'company-a',
          reason: null,
          metadata: { companyName: 'Company A' },
          ipAddress: '127.0.0.1',
          userAgent: 'jest-test-agent',
        },
      });
    });

    it('defaults optional fields to null instead of leaving them undefined', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      await service.record(prisma, {
        actorUserId: 'super-admin-1',
        actorRole: 'SUPER_ADMIN' as const,
        action: 'UPDATE_COMPANY_STATUS',
        entityType: 'Company',
      });

      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.affectedCompanyId).toBeNull();
      expect(data.entityId).toBeNull();
      expect(data.reason).toBeNull();
      expect(data.ipAddress).toBeNull();
      expect(data.userAgent).toBeNull();
    });

    it('throws InternalServerErrorException if the write fails, without leaking the underlying error', async () => {
      prisma.auditLog.create.mockRejectedValue(
        new Error('connection string: postgres://user:secret@host/db'),
      );

      await expect(service.record(prisma, input)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('list', () => {
    it('returns logs with actor/affectedCompany basics and no sensitive data', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'audit-1',
          actorUserId: 'super-admin-1',
          actorRole: 'SUPER_ADMIN',
          actor: {
            id: 'super-admin-1',
            name: 'Platform Admin',
            email: 'admin.platform@tehus.test',
          },
          affectedCompanyId: 'company-a',
          affectedCompany: { id: 'company-a', name: 'Company A' },
          action: 'CREATE_COMPANY',
          entityType: 'Company',
          entityId: 'company-a',
          reason: null,
          metadata: { companyName: 'Company A' },
          ipAddress: '127.0.0.1',
          userAgent: 'jest-test-agent',
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const result = await service.list();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('password');
      expect(result[0]).not.toHaveProperty('accessTokenEncrypted');
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      );
    });

    it('filters by action', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.list({ action: 'UPDATE_COMPANY_STATUS' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: 'UPDATE_COMPANY_STATUS' },
        }),
      );
    });

    it('filters by affectedCompanyId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.list({ affectedCompanyId: 'company-a' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { affectedCompanyId: 'company-a' },
        }),
      );
    });

    it('filters by actorUserId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.list({ actorUserId: 'super-admin-1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { actorUserId: 'super-admin-1' },
        }),
      );
    });
  });
});
