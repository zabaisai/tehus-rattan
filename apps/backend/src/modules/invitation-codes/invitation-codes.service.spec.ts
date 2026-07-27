import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationCodesService } from './invitation-codes.service';

const actor = {
  actorUserId: 'super-admin-1',
  actorRole: 'SUPER_ADMIN' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'jest-test-agent',
};

describe('InvitationCodesService', () => {
  let prisma: any;
  let auditLogService: any;
  let service: InvitationCodesService;

  beforeEach(() => {
    prisma = {
      invitationCode: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'invitation-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((arg: any) => arg(prisma)),
    };

    auditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new InvitationCodesService(prisma, auditLogService);
  });

  describe('create', () => {
    it('creates an invitation, hashes the code, and returns the plaintext exactly once', async () => {
      const result = await service.create(
        { intendedCompanyName: '  Acme  ' } as any,
        actor,
      );

      expect(prisma.invitationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            intendedCompanyName: 'Acme',
            createdByUserId: actor.actorUserId,
          }),
        }),
      );
      expect(result.code).toMatch(/^TEHUS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(auditLogService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'CREATE_INVITATION_CODE' }),
      );
    });

    it('rejects a blank company name', async () => {
      await expect(
        service.create({ intendedCompanyName: '   ' } as any, actor),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.invitationCode.create).not.toHaveBeenCalled();
    });

    it('rejects an expiresAt in the past', async () => {
      await expect(
        service.create(
          {
            intendedCompanyName: 'Acme',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          } as any,
          actor,
        ),
      ).rejects.toThrow('La fecha de vencimiento debe ser futura');
    });

    it('never persists the plaintext code, only its hash and a masked preview', async () => {
      const result = await service.create(
        { intendedCompanyName: 'Acme' } as any,
        actor,
      );

      const createCall = prisma.invitationCode.create.mock.calls[0][0];
      expect(createCall.data.codeHash).not.toBe(result.code);
      expect(createCall.data.codePreview).toMatch(/^TEHUS-\*{4}-\*{4}-\*{4}-[0-9A-F]{4}$/);
      expect(createCall.data.codePreview).not.toBe(result.code);
    });
  });

  describe('list', () => {
    it('expires overdue active codes before listing', async () => {
      await service.list();

      expect(prisma.invitationCode.updateMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', expiresAt: { lt: expect.any(Date) } },
        data: { status: 'EXPIRED' },
      });
      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters by a valid status', async () => {
      await service.list({ status: 'REVOKED' });

      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'REVOKED' } }),
      );
    });

    it('rejects an invalid status filter', async () => {
      await expect(service.list({ status: 'BOGUS' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('revoke', () => {
    it('revokes an active invitation and records the audit entry', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'invitation-1',
        status: 'ACTIVE',
        intendedCompanyName: 'Acme',
        codePreview: 'TEHUS-****-****-****-AAAA',
      });
      prisma.invitationCode.findUniqueOrThrow.mockResolvedValue({
        id: 'invitation-1',
        status: 'REVOKED',
      });

      const result = await service.revoke('invitation-1', actor);

      expect(prisma.invitationCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'invitation-1', status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: expect.any(Date),
          revokedByUserId: actor.actorUserId,
        },
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'REVOKE_INVITATION_CODE' }),
      );
      expect(result.status).toBe('REVOKED');
    });

    it('rejects a blank id', async () => {
      await expect(service.revoke('   ', actor)).rejects.toThrow(BadRequestException);
      expect(prisma.invitationCode.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the invitation does not exist', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue(null);

      await expect(service.revoke('missing', actor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects revoking an invitation that is not ACTIVE', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'invitation-1',
        status: 'USED',
      });

      await expect(service.revoke('invitation-1', actor)).rejects.toThrow(
        'Solo se pueden revocar invitaciones activas',
      );
      // The only updateMany call so far is expireOverdue's lazy-expiry
      // sweep — the revoke-specific conditional claim must never run for a
      // non-ACTIVE invitation.
      expect(prisma.invitationCode.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.invitationCode.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED' }) }),
      );
    });

    it('rejects when a concurrent request already changed the status (race)', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'invitation-1',
        status: 'ACTIVE',
      });
      prisma.invitationCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke('invitation-1', actor)).rejects.toThrow(
        'Solo se pueden revocar invitaciones activas',
      );
      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });
});
