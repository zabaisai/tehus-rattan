import { describe, expect, it, vi, beforeEach } from 'vitest';

const refreshAccessToken = vi.fn();
const getMe = vi.fn();

vi.mock('@/lib/axios', () => ({ refreshAccessToken: () => refreshAccessToken() }));
vi.mock('@/lib/auth', () => ({ getMe: () => getMe() }));

import { bootstrapSession, __resetBootstrapForTests } from './auth-bootstrap';
import { useAuthStore } from '@/store/auth.store';
import { getAccessToken, clearAccessToken } from './auth-token';

const user = { id: 'u1', email: 'a@co.test', name: 'Ana', role: 'ADMIN', companyId: 'c1' };

describe('session bootstrap after reload', () => {
  beforeEach(() => {
    __resetBootstrapForTests();
    refreshAccessToken.mockReset();
    getMe.mockReset();
    clearAccessToken();
    useAuthStore.setState({ user: null, status: 'bootstrapping' });
  });

  it('a live session (refresh 200 + /auth/me) ends authenticated with the token in memory', async () => {
    refreshAccessToken.mockResolvedValue('fresh-jwt');
    getMe.mockResolvedValue(user);

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user).toEqual(user);
    expect(getAccessToken()).toBe('fresh-jwt');
  });

  it('no session (refresh 401 → null) ends anonymous with no token', async () => {
    refreshAccessToken.mockResolvedValue(null);

    await bootstrapSession();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it('is single-flight: concurrent calls run the bootstrap once', async () => {
    refreshAccessToken.mockResolvedValue('fresh-jwt');
    getMe.mockResolvedValue(user);

    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});
