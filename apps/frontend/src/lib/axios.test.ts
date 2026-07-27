import { afterEach, beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
      create: actual.default.create,
    },
  };
});

// Spy on the cross-tab broadcast so we can assert a false logout NEVER
// propagates 'session-invalidated' on a transient/config failure.
const broadcastAuthEvent = vi.fn();
vi.mock('@/lib/auth-events', () => ({
  broadcastAuthEvent: (type: string) => broadcastAuthEvent(type),
}));

const mockedPost = axios.post as unknown as Mock;

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

function buildAxiosError(url: string) {
  return {
    response: { status: 401 },
    config: { url, headers: {} } as RetryableConfig,
    isAxiosError: true,
  };
}

// A rejection shaped like an AxiosError for a REFRESH call. `status` undefined
// models a network error / timeout (no response object at all).
function refreshError(status?: number, headers: Record<string, string> = {}) {
  if (status === undefined) {
    return { message: 'Network Error', request: {}, isAxiosError: true };
  }
  return { response: { status, headers }, isAxiosError: true };
}

// axios doesn't expose a public way to invoke a registered interceptor
// directly — reaching into the instance's own `handlers` array (a stable,
// widely-used pattern for testing axios interceptors) is how the response
// error handler under test actually gets invoked here.
function getResponseErrorHandler(api: AxiosInstance) {
  const manager = api.interceptors.response as unknown as {
    handlers: Array<{ rejected: (error: unknown) => Promise<unknown> }>;
  };
  return manager.handlers[manager.handlers.length - 1].rejected;
}

function getRequestHandler(api: AxiosInstance) {
  const manager = api.interceptors.request as unknown as {
    handlers: Array<{
      fulfilled: (
        config: InternalAxiosRequestConfig,
      ) => InternalAxiosRequestConfig;
    }>;
  };
  return manager.handlers[0].fulfilled;
}

const refreshCallCount = () =>
  mockedPost.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/auth/refresh')).length;

function stubLocation() {
  const original = window.location;
  Reflect.deleteProperty(window, 'location');
  Object.defineProperty(window, 'location', {
    value: { ...original, href: '', pathname: '/dashboard' },
    writable: true,
    configurable: true,
  });
  return () =>
    Object.defineProperty(window, 'location', {
      value: original,
      writable: true,
      configurable: true,
    });
}

// Load axios + its sibling modules from the SAME (post-reset) module graph and
// mark the session authenticated so a false logout is observable as a flip to
// 'anonymous'.
async function loadAuthenticated() {
  const { default: api } = await import('./axios');
  const { useAuthStore } = await import('@/store/auth.store');
  const { getAccessToken } = await import('./auth-token');
  useAuthStore.setState({ user: { id: 'u1' } as never, status: 'authenticated' });
  return { api, useAuthStore, getAccessToken };
}

describe('axios refresh interceptor', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mockedPost.mockReset();
    broadcastAuthEvent.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches the Authorization header from the in-memory token, never localStorage', async () => {
    const { default: api } = await import('./axios');
    const { setAccessToken } = await import('./auth-token');
    const requestHandler = getRequestHandler(api);

    localStorage.setItem('token', 'stale-localStorage-token');
    setAccessToken('memory-token');

    const config = { headers: {} } as InternalAxiosRequestConfig;
    const result = requestHandler(config);

    expect(result.headers.Authorization).toBe('Bearer memory-token');
    expect(String(result.headers.Authorization)).not.toContain('stale-localStorage-token');
  });

  it('sends no Authorization header when there is no in-memory token', async () => {
    const { default: api } = await import('./axios');
    const requestHandler = getRequestHandler(api);

    const config = { headers: {} } as InternalAxiosRequestConfig;
    const result = requestHandler(config);

    expect(result.headers.Authorization).toBeUndefined();
  });

  it('a successful refresh stores the new token in memory (not in localStorage)', async () => {
    mockedPost.mockResolvedValue({ data: { token: 'refreshed-token' } });

    const { default: api } = await import('./axios');
    const { getAccessToken } = await import('./auth-token');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(getAccessToken()).toBe('refreshed-token');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('two simultaneous 401s trigger exactly one POST /auth/refresh, not two', async () => {
    mockedPost.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: { token: 'new-token', user: { id: 'u1' } } }),
            10,
          ),
        ),
    );

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    const first = handler(buildAxiosError('/platform/companies')).catch(() => {});
    const second = handler(buildAxiosError('/platform/audit-logs')).catch(() => {});
    await Promise.all([first, second]);

    expect(refreshCallCount()).toBe(1);
  });

  it('never attempts a refresh for /auth/login, /auth/refresh, /auth/logout, or /onboarding', async () => {
    mockedPost.mockResolvedValue({ data: { token: 'new-token', user: { id: 'u1' } } });

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await Promise.allSettled([
      handler(buildAxiosError('/auth/login')),
      handler(buildAxiosError('/auth/refresh')),
      handler(buildAxiosError('/auth/logout')),
      handler(buildAxiosError('/onboarding/company')),
    ]);

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('retries the original request at most once even if the retry also 401s', async () => {
    mockedPost.mockResolvedValue({ data: { token: 'new-token', user: { id: 'u1' } } });

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    const alreadyRetried = buildAxiosError('/platform/companies');
    alreadyRetried.config._retry = true;

    await expect(handler(alreadyRetried)).rejects.toBeDefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  // ---- Refresh failure classification (the fix) --------------------------

  it('401 then 200: recovers and refreshes without logging out (recoverable CAS race)', async () => {
    mockedPost
      .mockRejectedValueOnce(refreshError(401))
      .mockResolvedValueOnce({ data: { token: 'recovered-token' } });
    const restore = stubLocation();

    const { getAccessToken } = await loadAuthenticated();
    const { default: api } = await import('./axios');
    const { useAuthStore } = await import('@/store/auth.store');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(getAccessToken()).toBe('recovered-token');
    expect(window.location.href).not.toContain('/login');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(broadcastAuthEvent).not.toHaveBeenCalled();
    expect(refreshCallCount()).toBe(2);
    restore();
  });

  it('two 401s: invalid session → clears session, broadcasts, redirects (bounded)', async () => {
    mockedPost.mockRejectedValue(refreshError(401));
    const restore = stubLocation();

    const { useAuthStore } = await loadAuthenticated();
    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).toContain('/login');
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(broadcastAuthEvent).toHaveBeenCalledWith('session-invalidated');
    // one initial + one recovery attempt, then it gives up — no loop.
    expect(refreshCallCount()).toBe(2);
    restore();
  });

  it('429: does NOT log out, broadcast or redirect, and does not retry immediately', async () => {
    mockedPost.mockRejectedValue(refreshError(429, { 'retry-after': '30' }));
    const restore = stubLocation();

    const { useAuthStore } = await loadAuthenticated();
    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).not.toContain('/login');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(broadcastAuthEvent).not.toHaveBeenCalled();
    // No second immediate attempt that would worsen the rate limit.
    expect(refreshCallCount()).toBe(1);
    restore();
  });

  it.each([500, 502, 503])('%d: transient error keeps the session (no logout)', async (status) => {
    mockedPost.mockRejectedValue(refreshError(status));
    const restore = stubLocation();

    const { useAuthStore } = await loadAuthenticated();
    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).not.toContain('/login');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(broadcastAuthEvent).not.toHaveBeenCalled();
    expect(refreshCallCount()).toBe(1);
    restore();
  });

  it('network error / timeout: keeps the session and does not loop', async () => {
    mockedPost.mockRejectedValue(refreshError(undefined));
    const restore = stubLocation();

    const { useAuthStore } = await loadAuthenticated();
    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).not.toContain('/login');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(broadcastAuthEvent).not.toHaveBeenCalled();
    expect(refreshCallCount()).toBe(1);
    restore();
  });

  it('403: configuration/security error → no logout and no refresh storm', async () => {
    mockedPost.mockRejectedValue(refreshError(403));
    const restore = stubLocation();

    const { useAuthStore } = await loadAuthenticated();
    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).not.toContain('/login');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(broadcastAuthEvent).not.toHaveBeenCalled();
    expect(refreshCallCount()).toBe(1);
    restore();
  });

  describe('cross-tab refresh coordination (Web Locks)', () => {
    it('serializes refresh through the Web Locks API when available', async () => {
      const requestMock = vi.fn(async (name: string, _opts: unknown, cb: () => Promise<unknown>) => cb());
      Object.defineProperty(navigator, 'locks', {
        value: { request: requestMock },
        writable: true,
        configurable: true,
      });
      mockedPost.mockResolvedValue({ data: { token: 'locked-token' } });

      const { refreshAccessToken } = await import('./axios');
      const result = await refreshAccessToken();

      expect(result).toEqual({ status: 'success', token: 'locked-token' });
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(requestMock.mock.calls[0][0]).toBe('tehus-auth-refresh');
      expect(requestMock.mock.calls[0][1]).toMatchObject({ mode: 'exclusive' });

      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'locks');
    });

    it('falls back to an unlocked refresh when Web Locks is unavailable (no loop)', async () => {
      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'locks');
      mockedPost.mockResolvedValue({ data: { token: 'fallback-token' } });

      const { refreshAccessToken } = await import('./axios');
      const result = await refreshAccessToken();

      expect(result).toEqual({ status: 'success', token: 'fallback-token' });
      expect(refreshCallCount()).toBe(1);
    });

    it('falls back to an unlocked refresh if acquiring the lock times out (abort)', async () => {
      const requestMock = vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      });
      Object.defineProperty(navigator, 'locks', {
        value: { request: requestMock },
        writable: true,
        configurable: true,
      });
      mockedPost.mockResolvedValue({ data: { token: 'after-timeout-token' } });

      const { refreshAccessToken } = await import('./axios');
      const result = await refreshAccessToken();

      expect(result).toEqual({ status: 'success', token: 'after-timeout-token' });
      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'locks');
    });
  });
});
