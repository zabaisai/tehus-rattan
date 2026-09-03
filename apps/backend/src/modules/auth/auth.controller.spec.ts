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
      login: jest.fn(),
      me: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };
    controller = new AuthController(authService);
  });

  it('does not gate /auth/login with the onboarding invite guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.login) ?? [];
    expect(guards).not.toContain(OnboardingInviteGuard);
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
        expect.objectContaining({ deviceIdHash: expect.any(String) }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'takto_refresh_token',
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
        cookies: { takto_refresh_token: 'old-plain-refresh-token' },
      });

      const result = await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith(
        'old-plain-refresh-token',
        expect.objectContaining({ deviceIdHash: expect.any(String) }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'takto_refresh_token',
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
        cookies: { takto_refresh_token: 'plain-refresh-token' },
      });

      await controller.logout(req, res);

      expect(authService.logout).toHaveBeenCalledWith('plain-refresh-token');
      expect(res.clearCookie).toHaveBeenCalledWith(
        'takto_refresh_token',
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

  // Fase 1: las cookies pasan de `tehus_*` a `takto_*` con fallback temporal.
  describe('legacy cookie fallback (tehus_* → takto_*)', () => {
    it('refresh accepts the legacy cookie, writes the canonical one and retires the legacy one', async () => {
      authService.refresh.mockResolvedValue({
        token: 'new-t',
        user: { id: 'u1', email: 'a@co.test', name: 'A' },
        refreshToken: 'rotated-refresh-token',
      });
      const res = buildRes();
      const req = buildReq({
        cookies: { tehus_refresh_token: 'legacy-plain-refresh-token' },
      });

      await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith(
        'legacy-plain-refresh-token',
        expect.anything(),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'takto_refresh_token',
        'rotated-refresh-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/auth',
        }),
      );
      // Nunca se escribe el nombre antiguo y se borra en la misma respuesta.
      expect(res.cookie).not.toHaveBeenCalledWith(
        'tehus_refresh_token',
        expect.anything(),
        expect.anything(),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'tehus_refresh_token',
        expect.objectContaining({ path: '/api/auth' }),
      );
    });

    it('refresh prefers the canonical cookie when both are present and does not touch the legacy one', async () => {
      authService.refresh.mockResolvedValue({
        token: 'new-t',
        user: { id: 'u1', email: 'a@co.test', name: 'A' },
        refreshToken: 'rotated',
      });
      const res = buildRes();
      const req = buildReq({
        cookies: {
          takto_refresh_token: 'canonical-token',
          tehus_refresh_token: 'legacy-token',
        },
      });

      await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith(
        'canonical-token',
        expect.anything(),
      );
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('logout reads the legacy cookie and clears BOTH names', async () => {
      authService.logout.mockResolvedValue(undefined);
      const res = buildRes();
      const req = buildReq({
        cookies: { tehus_refresh_token: 'legacy-plain-refresh-token' },
      });

      await controller.logout(req, res);

      expect(authService.logout).toHaveBeenCalledWith(
        'legacy-plain-refresh-token',
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'takto_refresh_token',
        expect.objectContaining({ path: '/api/auth' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'tehus_refresh_token',
        expect.objectContaining({ path: '/api/auth' }),
      );
    });

    it('login never sets the legacy cookie name', async () => {
      authService.login.mockResolvedValue({
        token: 't',
        user: { id: 'u1', email: 'a@co.test', name: 'A' },
        refreshToken: 'plain',
      });
      const res = buildRes();

      await controller.login(
        { email: 'a@co.test', password: 'password123' },
        buildReq(),
        res,
      );

      const names = res.cookie.mock.calls.map((c: unknown[]) => c[0]);
      expect(names).toEqual(['takto_refresh_token']);
    });
  });
});
