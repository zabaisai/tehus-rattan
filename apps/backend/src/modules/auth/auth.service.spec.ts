import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { SessionRequestContext } from '../sessions/utils/request-context.util';

const fakeContext: SessionRequestContext = {
  deviceId: 'device-1',
  ipAddress: '181.60.12.24',
  ipPreview: '181.***.***.24',
  userAgent: 'test-agent',
  browser: 'Chrome 120',
  operatingSystem: 'Windows 10',
  deviceType: 'DESKTOP',
};

describe('AuthService', () => {
  let prisma: any;
  let usersService: any;
  let jwtService: any;
  let sessionsService: any;
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
    sessionsService = {
      recordLoginSuccess: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        refreshToken: 'plain-refresh-token',
      }),
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
      rotateRefreshToken: jest.fn(),
      closeSessionByRefreshToken: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      usersService,
      jwtService,
      prisma,
      sessionsService,
    );
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

      const result = await service.login(
        'admin@company-a.test',
        'plain-password',
      );

      expect(result.token).toBe('signed-jwt');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ADMIN', companyId: 'company-a' }),
      );
    });

    it('normalizes the email (trim + lowercase) before looking it up', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('  Admin@Company-A.test  ', 'plain-password'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'admin@company-a.test' } }),
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

      const result = await service.login(
        'platform@tehus.test',
        'plain-password',
      );

      expect(result.token).toBe('signed-jwt');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'SUPER_ADMIN', companyId: null }),
      );
    });

    describe('with a request context (real /auth/login flow)', () => {
      it('creates/updates a UserSession and returns a refreshToken on success', async () => {
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

        const result = await service.login(
          'admin@company-a.test',
          'plain-password',
          fakeContext,
        );

        expect(sessionsService.recordLoginSuccess).toHaveBeenCalledWith({
          user: expect.objectContaining({ id: 'user-a', role: 'ADMIN' }),
          context: fakeContext,
        });
        expect(result.refreshToken).toBe('plain-refresh-token');
        // The session id is embedded in the JWT as `sid`, not returned raw.
        expect(jwtService.sign).toHaveBeenCalledWith(
          expect.objectContaining({ sid: 'session-1' }),
        );
        expect(sessionsService.recordLoginFailure).not.toHaveBeenCalled();
      });

      it('records a FAILED LoginEvent (never the password) on wrong password, and still throws', async () => {
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

        await expect(
          service.login('admin@company-a.test', 'wrong-password', fakeContext),
        ).rejects.toThrow(UnauthorizedException);

        expect(sessionsService.recordLoginFailure).toHaveBeenCalledWith(
          expect.objectContaining({
            emailAttempted: 'admin@company-a.test',
            failureReason: 'INVALID_CREDENTIALS',
            context: fakeContext,
          }),
        );
        const failureCall = sessionsService.recordLoginFailure.mock.calls[0][0];
        expect(JSON.stringify(failureCall)).not.toContain('wrong-password');
        expect(JSON.stringify(failureCall)).not.toContain(passwordHash);
        expect(sessionsService.recordLoginSuccess).not.toHaveBeenCalled();
      });

      it('records a FAILED LoginEvent for a non-existent email, without revealing that distinction to the caller', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          service.login('nobody@nowhere.test', 'whatever', fakeContext),
        ).rejects.toThrow('Credenciales inválidas');

        expect(sessionsService.recordLoginFailure).toHaveBeenCalledWith(
          expect.objectContaining({
            emailAttempted: 'nobody@nowhere.test',
            failureReason: 'INVALID_CREDENTIALS',
          }),
        );
      });

      it('records COMPANY_SUSPENDED as the failure reason for a suspended company', async () => {
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
          service.login('admin@company-b.test', 'plain-password', fakeContext),
        ).rejects.toThrow(UnauthorizedException);

        expect(sessionsService.recordLoginFailure).toHaveBeenCalledWith(
          expect.objectContaining({ failureReason: 'COMPANY_SUSPENDED' }),
        );
      });

      it('never awaits the failure-recording write into the rejection path (a slow/broken audit write cannot delay the 401)', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        let resolveWrite: () => void = () => {};
        sessionsService.recordLoginFailure.mockReturnValue(
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
        );

        await expect(
          service.login('nobody@nowhere.test', 'whatever', fakeContext),
        ).rejects.toThrow(UnauthorizedException);

        resolveWrite();
      });
    });
  });

  describe('refresh', () => {
    it('mints a new access token embedding the rotated session id', async () => {
      sessionsService.rotateRefreshToken.mockResolvedValue({
        sessionId: 'session-2',
        refreshToken: 'new-plain-refresh-token',
        user: {
          id: 'user-a',
          email: 'admin@company-a.test',
          name: 'Admin A',
          role: 'ADMIN',
          companyId: 'company-a',
        },
      });

      const result = await service.refresh(
        'old-plain-refresh-token',
        fakeContext,
      );

      expect(sessionsService.rotateRefreshToken).toHaveBeenCalledWith(
        'old-plain-refresh-token',
        fakeContext,
      );
      expect(result.refreshToken).toBe('new-plain-refresh-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sid: 'session-2' }),
      );
    });

    it('rejects when the session cannot be rotated (revoked, expired, unknown token)', async () => {
      sessionsService.rotateRefreshToken.mockResolvedValue(null);

      await expect(service.refresh('bad-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a missing refresh token cookie with 401, not an uncaught exception (regression: hashToken(undefined) used to throw and surface as a 500)', async () => {
      await expect(service.refresh(undefined, fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionsService.rotateRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('closes only the session tied to the given refresh token', async () => {
      await service.logout('plain-refresh-token');

      expect(sessionsService.closeSessionByRefreshToken).toHaveBeenCalledWith(
        'plain-refresh-token',
      );
    });

    it('is a silent no-op when there is no refresh token cookie', async () => {
      await service.logout(undefined);

      expect(sessionsService.closeSessionByRefreshToken).not.toHaveBeenCalled();
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
      // register() never touches session tracking — only real /auth/login does.
      expect(sessionsService.recordLoginSuccess).not.toHaveBeenCalled();
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
