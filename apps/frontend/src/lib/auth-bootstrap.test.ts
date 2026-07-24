import { describe, expect, it, vi, beforeEach } from 'vitest';

const refreshAccessToken = vi.fn();
const getMe = vi.fn();

vi.mock('@/lib/axios', async () => {
  const actual = await vi.importActual<typeof import('./axios')>('./axios');
  return {
    refreshAccessToken: () => refreshAccessToken(),
    // Use the real classifier so bootstrap branches exactly as production does.
    classifyRefreshError: actual.classifyRefreshError,
  };
});
vi.mock('@/lib/auth', () => ({ getMe: () => getMe() }));

import { bootstrapSession, retryBootstrap, __resetBootstrapForTests } from './auth-bootstrap';
import { useAuthStore } from '@/store/auth.store';
import { getAccessToken, clearAccessToken, setAccessToken } from './auth-token';

const user = { id: 'u1', email: 'a@co.test', name: 'Ana', role: 'ADMIN', companyId: 'c1' };
const meError = (status?: number) =>
  status === undefined ? { message: 'Network Error' } : { response: { status } };

describe('session bootstrap after reload', () => {
  beforeEach(() => {
    __resetBootstrapForTests();
    refreshAccessToken.mockReset();
    getMe.mockReset();
    clearAccessToken();
    useAuthStore.setState({ user: null, status: 'bootstrapping' });
  });

  it('a live session (refresh success + /auth/me) ends authenticated with the token in memory', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'success', token: 'fresh-jwt' });
    getMe.mockResolvedValue(user);

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user).toEqual(user);
    expect(getAccessToken()).toBe('fresh-jwt');
  });

  it('a genuinely invalid session (refresh invalid-session) ends anonymous with no token', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'invalid-session' });

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it('a transient refresh failure (429/network/5xx) ends "unavailable", NOT login', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'transient-error' });

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('unavailable');
    expect(getMe).not.toHaveBeenCalled();
  });

  it('a configuration error (403) also ends "unavailable", not anonymous', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'configuration-error' });

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('unavailable');
  });

  it('refresh ok but /auth/me transient failure → unavailable (session not dropped)', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'success', token: 'fresh-jwt' });
    getMe.mockRejectedValue(meError(503));

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('unavailable');
  });

  it('refresh ok but /auth/me 401 (revoked in between) → anonymous', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'success', token: 'fresh-jwt' });
    getMe.mockRejectedValue(meError(401));

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('is single-flight: concurrent calls run the bootstrap once', async () => {
    refreshAccessToken.mockResolvedValue({ status: 'success', token: 'fresh-jwt' });
    getMe.mockResolvedValue(user);

    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('retryBootstrap re-runs after an unavailable result and can succeed', async () => {
    setAccessToken(null);
    refreshAccessToken.mockResolvedValueOnce({ status: 'transient-error' });
    await bootstrapSession();
    expect(useAuthStore.getState().status).toBe('unavailable');

    // Retry: server is back.
    refreshAccessToken.mockResolvedValueOnce({ status: 'success', token: 'fresh-jwt' });
    getMe.mockResolvedValueOnce(user);
    await retryBootstrap();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });
});
