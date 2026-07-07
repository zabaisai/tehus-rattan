import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let prisma: any;
  let usersService: any;
  let jwtService: any;
  let service: AuthService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('plain-password', 10);
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      company: { create: jest.fn() },
    };
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') };

    service = new AuthService(usersService, jwtService, prisma);
  });

  describe('login', () => {
    it('allows an ADMIN of an ACTIVE company to log in', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-a',
        email: 'admin@company-a.test',
        password: passwordHash,
        name: 'Admin A',
        role: 'ADMIN',
        isActive: true,
        companyId: 'company-a',
        company: { id: 'company-a', status: 'ACTIVE' },
      });

      const result = await service.login('admin@company-a.test', 'plain-password');

      expect(result.token).toBe('signed-jwt');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ADMIN', companyId: 'company-a' }),
      );
    });

    it('rejects an ADMIN of a SUSPENDED company', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-b',
        email: 'admin@company-b.test',
        password: passwordHash,
        name: 'Admin B',
        role: 'ADMIN',
        isActive: true,
        companyId: 'company-b',
        company: { id: 'company-b', status: 'SUSPENDED' },
      });

      await expect(
        service.login('admin@company-b.test', 'plain-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('rejects an ADMIN of a DELETED company', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-c',
        email: 'admin@company-c.test',
        password: passwordHash,
        name: 'Admin C',
        role: 'ADMIN',
        isActive: true,
        companyId: 'company-c',
        company: { id: 'company-c', status: 'DELETED' },
      });

      await expect(
        service.login('admin@company-c.test', 'plain-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('allows a global SUPER_ADMIN with companyId null to log in', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-d',
        email: 'platform@tehus.test',
        password: passwordHash,
        name: 'Platform Admin',
        role: 'SUPER_ADMIN',
        isActive: true,
        companyId: null,
        company: null,
      });

      const result = await service.login('platform@tehus.test', 'plain-password');

      expect(result.token).toBe('signed-jwt');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'SUPER_ADMIN', companyId: null }),
      );
    });
  });

  describe('register', () => {
    it('creates a Company and an ADMIN user with companyId set', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      prisma.company.create.mockResolvedValue({
        id: 'company-new',
        name: 'New Co',
      });
      usersService.create.mockResolvedValue({
        id: 'user-new',
        email: 'new@company.test',
        name: 'New Admin',
        role: 'ADMIN',
        companyId: 'company-new',
      });

      const result = await service.register({
        companyName: 'New Co',
        name: 'New Admin',
        email: 'new@company.test',
        password: 'plain-password',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-new', role: 'ADMIN' }),
      );
      expect(result.token).toBe('signed-jwt');
    });

    it('never creates a user with role SUPER_ADMIN', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      prisma.company.create.mockResolvedValue({
        id: 'company-new-2',
        name: 'New Co 2',
      });
      usersService.create.mockResolvedValue({
        id: 'user-new-2',
        email: 'new2@company.test',
        name: 'New Admin 2',
        role: 'ADMIN',
        companyId: 'company-new-2',
      });

      await service.register({
        companyName: 'New Co 2',
        name: 'New Admin 2',
        email: 'new2@company.test',
        password: 'plain-password',
      });

      const createArgs = usersService.create.mock.calls[0][0];
      expect(createArgs.role).toBe('ADMIN');
      expect(createArgs.role).not.toBe('SUPER_ADMIN');
    });
  });
});
