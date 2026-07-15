import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';

function buildReq(overrides: Record<string, unknown> = {}) {
  return {
    ip: '181.60.12.24',
    deviceId: 'device-1',
    headers: { 'user-agent': 'jest-test-agent' },
    cookies: {},
    ...overrides,
  } as any;
}

function buildRes() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as any;
}

describe('AuthController', () => {
  let authService: any;
  let controller: AuthController;

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      me: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };
    controller = new AuthController(authService);
  });

  it('applies OnboardingInviteGuard to POST /auth/register', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reflection only, never invoked
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.register);
    expect(guards).toContain(OnboardingInviteGuard);
  });

  it('does not gate /auth/login with the onboarding invite guard', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reflection only, never invoked
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.login) ?? [];
    expect(guards).not.toContain(OnboardingInviteGuard);
  });

  it('delegates register to authService.register', async () => {
    authService.register.mockResolvedValue({ token: 't', user: {} });
    const body = {
      companyName: 'Co',
      name: 'Admin',
      email: 'a@co.test',
      password: 'password123',
    };

    await controller.register(body);

    expect(authService.register).toHaveBeenCalledWith(body);
  });

  describe('login', () => {
    it('delegates to authService.login with a built request context, sets the refresh cookie, and never leaks the refresh token in the response body', async () => {
      authService.login.mockResolvedValue({
        token: 't',
        user: { id: 'u1', email: 'a@co.test', name: 'A' },
        refreshToken: 'plain-refresh-token',
      });
      const res = buildRes();

      const result = await controller.login(
        { email: 'a@co.test', password: 'password123' },
        buildReq(),
        res,
      );

      expect(authService.login).toHaveBeenCalledWith(
        'a@co.test',
        'password123',
        expect.objectContaining({ deviceId: 'device-1' }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'tehus_refresh_token',
        'plain-refresh-token',
        expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
      );
      expect(result).toEqual({
        token: 't',
        user: { id: 'u1', email: 'a@co.test', name: 'A' },
      });
      expect(JSON.stringify(result)).not.toContain('plain-refresh-token');
    });
  });

  describe('refresh', () => {
    it('reads the refresh token only from the cookie, rotates it, and sets the new cookie', async () => {
      authService.refresh.mockResolvedValue({
        token: 'new-t',
        user: { id: 'u1', email: 'a@co.test', name: 'A' },
        refreshToken: 'new-plain-refresh-token',
      });
      const res = buildRes();
      const req = buildReq({
        cookies: { tehus_refresh_token: 'old-plain-refresh-token' },
      });

      const result = await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith(
        'old-plain-refresh-token',
        expect.objectContaining({ deviceId: 'device-1' }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'tehus_refresh_token',
        'new-plain-refresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(JSON.stringify(result)).not.toContain('new-plain-refresh-token');
    });

    it('passes undefined through to authService.refresh when there is no cookie at all (e.g. after logout)', async () => {
      authService.refresh.mockRejectedValue(
        new Error('Sesión inválida o expirada'),
      );
      const req = buildReq({ cookies: {} });

      await expect(controller.refresh(req, buildRes())).rejects.toThrow();
      expect(authService.refresh).toHaveBeenCalledWith(
        undefined,
        expect.anything(),
      );
    });
  });

  describe('logout', () => {
    it('reads the refresh token from the cookie, closes the session, and clears the cookie', async () => {
      authService.logout.mockResolvedValue(undefined);
      const res = buildRes();
      const req = buildReq({
        cookies: { tehus_refresh_token: 'plain-refresh-token' },
      });

      await controller.logout(req, res);

      expect(authService.logout).toHaveBeenCalledWith('plain-refresh-token');
      expect(res.clearCookie).toHaveBeenCalledWith(
        'tehus_refresh_token',
        expect.objectContaining({ path: '/api/auth' }),
      );
    });

    it('still clears the cookie and succeeds even with no refresh cookie at all', async () => {
      authService.logout.mockResolvedValue(undefined);
      const res = buildRes();

      await controller.logout(buildReq({ cookies: {} }), res);

      expect(authService.logout).toHaveBeenCalledWith(undefined);
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });
});
