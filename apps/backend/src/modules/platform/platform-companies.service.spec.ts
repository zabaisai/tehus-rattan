import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PlatformCompaniesService } from './platform-companies.service';
import { PlatformAuditLogService } from './platform-audit-log.service';

const actor = {
  actorUserId: 'super-admin-1',
  actorRole: 'SUPER_ADMIN' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'jest-test-agent',
};

describe('PlatformCompaniesService', () => {
  let prisma: any;
  let auditLogService: PlatformAuditLogService;
  let service: PlatformCompaniesService;

  beforeEach(() => {
    prisma = {
      company: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      lead: {
        findMany: jest.fn(),
      },
      conversation: {
        findMany: jest.fn(),
      },
      task: {
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
    service = new PlatformCompaniesService(prisma, auditLogService);
  });

  describe('listCompanies', () => {
    const rawCompany = {
      id: 'company-a',
      name: 'Company A',
      phone: '+50255550000',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      users: [{ isActive: true }, { isActive: false }],
      _count: { contacts: 3, leads: 5, conversations: 2 },
      whatsappIntegration: { status: 'CONNECTED' },
    };

    it('returns companies with superficial counts and no sensitive data', async () => {
      prisma.company.findMany.mockResolvedValue([rawCompany]);

      const result = await service.listCompanies({});

      expect(result).toEqual([
        {
          id: 'company-a',
          name: 'Company A',
          phone: '+50255550000',
          status: 'ACTIVE',
          createdAt: rawCompany.createdAt,
          updatedAt: rawCompany.updatedAt,
          totalUsers: 2,
          activeUsers: 1,
          totalContacts: 3,
          totalLeads: 5,
          totalConversations: 2,
          whatsappConnected: true,
        },
      ]);
      expect(result[0]).not.toHaveProperty('users');
      expect(result[0]).not.toHaveProperty('password');
      expect(result[0]).not.toHaveProperty('accessTokenEncrypted');
    });

    it('filters by search', async () => {
      prisma.company.findMany.mockResolvedValue([]);

      await service.listCompanies({ search: 'acme' });

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'acme', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('filters by status', async () => {
      prisma.company.findMany.mockResolvedValue([]);

      await service.listCompanies({ status: 'SUSPENDED' });

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SUSPENDED' }),
        }),
      );
    });

    it('rejects an invalid status filter with BadRequestException', async () => {
      await expect(
        service.listCompanies({ status: 'NOT_A_STATUS' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCompanyDetail', () => {
    it('returns a safe detail view', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        phone: '+50255550000',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        users: [
          {
            id: 'user-1',
            name: 'Admin A',
            email: 'admin@company-a.test',
            role: 'ADMIN',
            isActive: true,
            createdAt: new Date('2026-01-01'),
          },
        ],
        _count: {
          contacts: 3,
          leads: 5,
          conversations: 2,
          tasks: 1,
          products: 0,
        },
        whatsappIntegration: {
          status: 'CONNECTED',
          phoneNumberId: 'phone-a',
          displayPhoneNumber: '+50255550000',
        },
      });

      const result = await service.getCompanyDetail('company-a');

      expect(result.users.total).toBe(1);
      expect(result.users.items[0]).not.toHaveProperty('password');
      expect(result.counts).toEqual({
        contacts: 3,
        leads: 5,
        conversations: 2,
        tasks: 1,
        products: 0,
      });
      expect(result.whatsapp).toEqual({
        connected: true,
        status: 'CONNECTED',
        phoneNumberId: 'phone-a',
        displayPhoneNumber: '+50255550000',
      });
      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('throws NotFoundException when the company does not exist', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(service.getCompanyDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createCompany', () => {
    const validDto = {
      companyName: 'New Co',
      companyPhone: '+50255551111',
      adminName: 'New Admin',
      adminEmail: 'new-admin@company.test',
      adminPassword: 'plain-password',
    };

    it('creates a Company and an ADMIN with a bcrypt-hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue(null);
      prisma.company.create.mockImplementation(async ({ data }: any) => ({
        id: 'company-new',
        name: data.name,
        phone: data.phone,
        status: data.status,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        users: [
          {
            id: 'user-new',
            name: data.users.create.name,
            email: data.users.create.email,
            role: data.users.create.role,
            isActive: true,
            createdAt: new Date('2026-01-01'),
          },
        ],
      }));

      const result = await service.createCompany(validDto as any, actor);

      const createCall = prisma.company.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('ACTIVE');
      expect(createCall.data.users.create.role).toBe('ADMIN');
      expect(createCall.data.users.create.password).not.toBe(
        validDto.adminPassword,
      );

      const passwordMatches = await bcrypt.compare(
        validDto.adminPassword,
        createCall.data.users.create.password,
      );
      expect(passwordMatches).toBe(true);
      expect(result.admin.email).toBe(validDto.adminEmail);
    });

    it('never returns a password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue(null);
      prisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'New Co',
        phone: '+50255551111',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        users: [
          {
            id: 'user-new',
            name: 'New Admin',
            email: 'new-admin@company.test',
            role: 'ADMIN',
            isActive: true,
            createdAt: new Date('2026-01-01'),
          },
        ],
      });

      const result = await service.createCompany(validDto as any, actor);

      expect(result).not.toHaveProperty('password');
      expect(result.admin).not.toHaveProperty('password');
    });

    it('throws ConflictException when adminEmail already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.createCompany(validDto as any, actor),
      ).rejects.toThrow(ConflictException);
      expect(prisma.company.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when companyPhone already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'existing-company' });

      await expect(
        service.createCompany(validDto as any, actor),
      ).rejects.toThrow(ConflictException);
      expect(prisma.company.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('records a CREATE_COMPANY audit log without adminPassword or a password hash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue(null);
      prisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'New Co',
        phone: '+50255551111',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        users: [
          {
            id: 'user-new',
            name: 'New Admin',
            email: 'new-admin@company.test',
            role: 'ADMIN',
            isActive: true,
            createdAt: new Date('2026-01-01'),
          },
        ],
      });

      await service.createCompany(validDto as any, actor);

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditCall.action).toBe('CREATE_COMPANY');
      expect(auditCall.entityType).toBe('Company');
      expect(auditCall.entityId).toBe('company-new');
      expect(auditCall.actorUserId).toBe(actor.actorUserId);
      expect(auditCall.actorRole).toBe(actor.actorRole);
      expect(auditCall.affectedCompanyId).toBe('company-new');
      expect(auditCall.metadata).toEqual({
        companyName: 'New Co',
        companyPhone: '+50255551111',
        adminEmail: 'new-admin@company.test',
        adminUserId: 'user-new',
        companyId: 'company-new',
      });

      const serialized = JSON.stringify(auditCall);
      expect(serialized).not.toContain('plain-password');
      expect(serialized.toLowerCase()).not.toContain('password');
      expect(serialized).not.toContain('$2a$');
      expect(serialized).not.toContain('$2b$');
    });

    it('rolls back the Company/User creation if writing the audit log fails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue(null);
      prisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'New Co',
        phone: '+50255551111',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        users: [
          {
            id: 'user-new',
            name: 'New Admin',
            email: 'new-admin@company.test',
            role: 'ADMIN',
            isActive: true,
            createdAt: new Date('2026-01-01'),
          },
        ],
      });
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      // A real Prisma $transaction rejects if the callback throws; the mock
      // mirrors that so the "operation fails if the audit write fails" rule
      // is actually exercised end-to-end through the transaction boundary.
      prisma.$transaction.mockImplementation(
        async (callback: (tx: any) => Promise<any>) => callback(prisma),
      );

      await expect(
        service.createCompany(validDto as any, actor),
      ).rejects.toThrow();
    });
  });

  describe('updateCompanyStatus', () => {
    it('changes ACTIVE to SUSPENDED and records an audit log', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'ACTIVE',
      });
      prisma.company.update.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'SUSPENDED',
      });

      const result = await service.updateCompanyStatus(
        'company-a',
        'SUSPENDED' as any,
        actor,
        'Falta de pago reportada',
      );

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-a' },
          data: { status: 'SUSPENDED' },
        }),
      );
      expect(result.status).toBe('SUSPENDED');

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditCall.action).toBe('UPDATE_COMPANY_STATUS');
      expect(auditCall.affectedCompanyId).toBe('company-a');
      expect(auditCall.reason).toBe('Falta de pago reportada');
      expect(auditCall.metadata).toEqual({
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        companyName: 'Company A',
        companyId: 'company-a',
      });
    });

    it('changes SUSPENDED to ACTIVE', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'SUSPENDED',
      });
      prisma.company.update.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'ACTIVE',
      });

      const result = await service.updateCompanyStatus(
        'company-a',
        'ACTIVE' as any,
        actor,
      );

      expect(result.status).toBe('ACTIVE');
    });

    it('changes ACTIVE/SUSPENDED to DELETED', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'ACTIVE',
      });
      prisma.company.update.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'DELETED',
      });

      const result = await service.updateCompanyStatus(
        'company-a',
        'DELETED' as any,
        actor,
      );

      expect(result.status).toBe('DELETED');
    });

    it('blocks reactivating a DELETED company with BadRequestException and does not audit-log it', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        name: 'Company A',
        status: 'DELETED',
      });

      await expect(
        service.updateCompanyStatus('company-a', 'ACTIVE' as any, actor),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.company.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and does not create an audit log when the company does not exist', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCompanyStatus('missing', 'ACTIVE' as any, actor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('getSupportOverview', () => {
    const rawCompany = {
      id: 'company-a',
      name: 'Company A',
      phone: '+50255550000',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-05'),
      users: [
        {
          id: 'user-1',
          name: 'Admin A',
          email: 'admin@company-a.test',
          role: 'ADMIN',
          isActive: true,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'user-2',
          name: 'Inactive Agent',
          email: 'agent@company-a.test',
          role: 'AGENT',
          isActive: false,
          createdAt: new Date('2026-01-02'),
        },
      ],
      _count: {
        contacts: 3,
        leads: 12,
        conversations: 7,
        tasks: 4,
        products: 2,
      },
      whatsappIntegration: {
        status: 'CONNECTED',
        phoneNumberId: 'phone-a',
        displayPhoneNumber: '+50255550000',
      },
    };

    function stubQueries(overrides: Partial<{ leads: any[]; conversations: any[]; tasks: any[] }> = {}) {
      prisma.company.findUnique.mockResolvedValue(rawCompany);
      prisma.lead.findMany.mockResolvedValue(overrides.leads ?? []);
      prisma.conversation.findMany.mockResolvedValue(
        overrides.conversations ?? [],
      );
      prisma.task.findMany.mockResolvedValue(overrides.tasks ?? []);
      prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    }

    it('lets a global SUPER_ADMIN query the overview and returns a safe shape', async () => {
      stubQueries();

      const result = await service.getSupportOverview('company-a', actor);

      expect(result.company).toEqual({
        id: 'company-a',
        name: 'Company A',
        phone: '+50255550000',
        status: 'ACTIVE',
        createdAt: rawCompany.createdAt,
        updatedAt: rawCompany.updatedAt,
      });
      expect(result.users).toEqual({
        total: 2,
        active: 1,
        items: rawCompany.users,
      });
      expect(result.counts).toEqual({
        contacts: 3,
        leads: 12,
        conversations: 7,
        tasks: 4,
        products: 2,
      });
      expect(result.whatsapp).toEqual({
        connected: true,
        status: 'CONNECTED',
        phoneNumberId: 'phone-a',
        displayPhoneNumber: '+50255550000',
      });
    });

    it('throws NotFoundException for a company that does not exist', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(
        service.getSupportOverview('missing', actor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(prisma.lead.findMany).not.toHaveBeenCalled();
    });

    it('never includes accessTokenEncrypted in the response', async () => {
      stubQueries();

      const result = await service.getSupportOverview('company-a', actor);

      expect(JSON.stringify(result)).not.toContain('accessTokenEncrypted');
      expect(result.whatsapp).not.toHaveProperty('accessTokenEncrypted');
    });

    it('never includes messages or conversation content', async () => {
      stubQueries({
        conversations: [
          {
            id: 'conv-1',
            status: 'OPEN',
            channel: 'whatsapp',
            createdAt: new Date('2026-01-04'),
            updatedAt: new Date('2026-01-04'),
            contact: { id: 'contact-1', name: 'Jane Doe' },
            agent: { id: 'user-1', name: 'Admin A' },
          },
        ],
      });

      const result = await service.getSupportOverview('company-a', actor);

      expect(result.recentConversations[0]).not.toHaveProperty('messages');
      expect(result.recentConversations[0]).not.toHaveProperty(
        'lastMessage',
      );
      expect(JSON.stringify(result)).not.toContain('"messages"');
    });

    it('never includes passwords or password hashes', async () => {
      stubQueries();

      const result = await service.getSupportOverview('company-a', actor);

      expect(JSON.stringify(result)).not.toContain('$2a$');
      expect(JSON.stringify(result)).not.toContain('$2b$');
      result.users.items.forEach((u: any) => {
        expect(u).not.toHaveProperty('password');
      });
    });

    it('records a VIEW_COMPANY_SUPPORT_OVERVIEW audit log with safe metadata', async () => {
      stubQueries();

      await service.getSupportOverview('company-a', actor);

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const auditCall = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditCall.action).toBe('VIEW_COMPANY_SUPPORT_OVERVIEW');
      expect(auditCall.entityType).toBe('Company');
      expect(auditCall.entityId).toBe('company-a');
      expect(auditCall.affectedCompanyId).toBe('company-a');
      expect(auditCall.actorUserId).toBe(actor.actorUserId);
      expect(auditCall.metadata).toEqual({
        companyId: 'company-a',
        companyName: 'Company A',
      });
    });

    it('fails the request if writing the audit log fails, and never returns data', async () => {
      stubQueries();
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.getSupportOverview('company-a', actor),
      ).rejects.toThrow();
    });

    it('limits recentLeads, recentConversations, and recentTasks to 5', async () => {
      stubQueries();

      await service.getSupportOverview('company-a', actor);

      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, orderBy: { updatedAt: 'desc' } }),
      );
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, orderBy: { updatedAt: 'desc' } }),
      );
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, orderBy: { updatedAt: 'desc' } }),
      );
    });

    it('computes lastActivityAt as the max updatedAt across the three recent lists', async () => {
      stubQueries({
        leads: [
          {
            id: 'lead-1',
            title: 'Lead 1',
            status: 'OPEN',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-03'),
            stage: { name: 'Nuevo' },
            agent: null,
          },
        ],
        conversations: [
          {
            id: 'conv-1',
            status: 'OPEN',
            channel: 'whatsapp',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-08'),
            contact: { id: 'contact-1', name: 'Jane Doe' },
            agent: null,
          },
        ],
        tasks: [
          {
            id: 'task-1',
            title: 'Task 1',
            status: 'PENDING',
            dueDate: null,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-02'),
            agent: null,
          },
        ],
      });

      const result = await service.getSupportOverview('company-a', actor);

      expect(result.lastActivityAt).toEqual(new Date('2026-01-08'));
    });

    it('returns lastActivityAt null when there is no recent activity at all', async () => {
      stubQueries();

      const result = await service.getSupportOverview('company-a', actor);

      expect(result.lastActivityAt).toBeNull();
    });
  });
});
