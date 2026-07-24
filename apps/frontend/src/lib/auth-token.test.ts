import { describe, expect, it, beforeEach } from 'vitest';
import { getAccessToken, setAccessToken, clearAccessToken } from './auth-token';

describe('in-memory access token container', () => {
  beforeEach(() => clearAccessToken());

  it('stores and returns the token from memory', () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken('jwt-abc');
    expect(getAccessToken()).toBe('jwt-abc');
  });

  it('clears the token', () => {
    setAccessToken('jwt-abc');
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it('never touches localStorage, sessionStorage or cookies', () => {
    setAccessToken('jwt-secret-value');
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(document.cookie).not.toContain('jwt-secret-value');
  });
});
