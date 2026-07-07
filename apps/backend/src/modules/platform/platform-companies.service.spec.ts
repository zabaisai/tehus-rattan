import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PlatformCompaniesService } from './platform-companies.service';

describe('PlatformCompaniesService', () => {
  let prisma: any;
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
    };
    service = new PlatformCompaniesService(prisma);
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

      const result = await service.createCompany(validDto as any);

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

      const result = await service.createCompany(validDto as any);

      expect(result).not.toHaveProperty('password');
      expect(result.admin).not.toHaveProperty('password');
    });

    it('throws ConflictException when adminEmail already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.createCompany(validDto as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when companyPhone already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue({ id: 'existing-company' });

      await expect(service.createCompany(validDto as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.company.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCompanyStatus', () => {
    it('changes ACTIVE to SUSPENDED', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        status: 'ACTIVE',
      });
      prisma.company.update.mockResolvedValue({
        id: 'company-a',
        status: 'SUSPENDED',
      });

      const result = await service.updateCompanyStatus(
        'company-a',
        'SUSPENDED' as any,
      );

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-a' },
          data: { status: 'SUSPENDED' },
        }),
      );
      expect(result.status).toBe('SUSPENDED');
    });

    it('changes SUSPENDED to ACTIVE', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        status: 'SUSPENDED',
      });
      prisma.company.update.mockResolvedValue({
        id: 'company-a',
        status: 'ACTIVE',
      });

      const result = await service.updateCompanyStatus(
        'company-a',
        'ACTIVE' as any,
      );

      expect(result.status).toBe('ACTIVE');
    });

    it('changes ACTIVE/SUSPENDED to DELETED', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        status: 'ACTIVE',
      });
      prisma.company.update.mockResolvedValue({
        id: 'company-a',
        status: 'DELETED',
      });

      const result = await service.updateCompanyStatus(
        'company-a',
        'DELETED' as any,
      );

      expect(result.status).toBe('DELETED');
    });

    it('blocks reactivating a DELETED company with BadRequestException', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-a',
        status: 'DELETED',
      });

      await expect(
        service.updateCompanyStatus('company-a', 'ACTIVE' as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the company does not exist', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCompanyStatus('missing', 'ACTIVE' as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
