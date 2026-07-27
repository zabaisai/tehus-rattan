import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useAuthStore } from './auth.store';
import { getAccessToken } from '@/lib/auth-token';
import type { User } from '@/types';

const user: User = {
  id: 'u1',
  email: 'a@co.test',
  name: 'Ana',
  role: 'ADMIN',
  companyId: 'c1',
};

describe('auth store (no JWT persistence)', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({ status: 'bootstrapping' });
  });

  it('setSession puts the token in memory only, and marks authenticated', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const cookieBefore = document.cookie;

    useAuthStore.getState().setSession(user, 'jwt-token-xyz');

    expect(getAccessToken()).toBe('jwt-token-xyz');
    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().status).toBe('authenticated');

    // The JWT must not be written to any web storage or cookie.
    const wroteToken = setItem.mock.calls.some(([, value]) =>
      String(value).includes('jwt-token-xyz'),
    );
    expect(wroteToken).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(document.cookie).toBe(cookieBefore);
    expect(document.cookie).not.toContain('jwt-token-xyz');
    setItem.mockRestore();
  });

  it('clearSession clears the in-memory token, user and marks anonymous', () => {
    useAuthStore.getState().setSession(user, 'jwt-token-xyz');
    useAuthStore.getState().clearSession();

    expect(getAccessToken()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('has no token/isAuthenticated field on the state (token lives outside the store)', () => {
    const state = useAuthStore.getState() as Record<string, unknown>;
    expect('token' in state).toBe(false);
    expect('isAuthenticated' in state).toBe(false);
  });
});
