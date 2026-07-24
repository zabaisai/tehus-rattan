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

const mockedPost = axios.post as unknown as Mock;

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

function buildAxiosError(url: string) {
  return {
    response: { status: 401 },
    config: { url, headers: {} } as RetryableConfig,
    isAxiosError: true,
  };
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

describe('axios refresh interceptor', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mockedPost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches the Authorization header from the in-memory token, never localStorage', async () => {
    // Import axios and its auth-token from the SAME (post-reset) module graph.
    const { default: api } = await import('./axios');
    const { setAccessToken } = await import('./auth-token');
    const requestHandler = getRequestHandler(api);

    // A stale localStorage token must be ignored entirely.
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
            () =>
              resolve({
                data: { token: 'new-token', user: { id: 'u1', email: 'a@co.test', name: 'A' } },
              }),
            10,
          ),
        ),
    );

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    // Both requests 401 "at the same time" — before either has resolved a
    // refresh — so the second must piggyback on the first's in-flight
    // promise rather than starting its own.
    const first = handler(buildAxiosError('/platform/companies')).catch(() => {});
    const second = handler(buildAxiosError('/platform/audit-logs')).catch(() => {});

    await Promise.all([first, second]);

    const refreshCalls = mockedPost.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('never attempts a refresh for /auth/login, /auth/refresh, /auth/logout, or /onboarding', async () => {
    mockedPost.mockResolvedValue({
      data: { token: 'new-token', user: { id: 'u1', email: 'a@co.test', name: 'A' } },
    });

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

  const refreshCallCount = () =>
    mockedPost.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/auth/refresh')).length;

  it('a genuinely invalid refresh (two failures) clears the session and redirects — bounded, no loop', async () => {
    // Both attempts fail → session is really gone.
    mockedPost.mockRejectedValue(new Error('refresh failed'));
    const restore = stubLocation();

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).toContain('/login');
    // Exactly one initial attempt + one recovery retry, then it gives up — no
    // unbounded loop.
    expect(refreshCallCount()).toBe(2);
    restore();
  });

  it('a recoverable race (refresh 401 then 200) refreshes without logging out', async () => {
    // First attempt fails (token spent by another tab), retry with the
    // now-current cookie succeeds → NO session-invalidated, NO redirect.
    mockedPost
      .mockRejectedValueOnce(new Error('token already rotated'))
      .mockResolvedValueOnce({ data: { token: 'recovered-token' } });
    const restore = stubLocation();

    const { default: api } = await import('./axios');
    const { getAccessToken } = await import('./auth-token');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).not.toContain('/login');
    expect(getAccessToken()).toBe('recovered-token');
    expect(refreshCallCount()).toBe(2);
    restore();
  });

  it('retries the original request at most once even if the retry also 401s', async () => {
    mockedPost.mockResolvedValue({
      data: { token: 'new-token', user: { id: 'u1', email: 'a@co.test', name: 'A' } },
    });

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    // Simulate: request already marked _retry (as api() would do internally
    // after the first pass) hitting 401 again.
    const alreadyRetried = buildAxiosError('/platform/companies');
    alreadyRetried.config._retry = true;

    await expect(handler(alreadyRetried)).rejects.toBeDefined();
    expect(mockedPost).not.toHaveBeenCalled();
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
      const token = await refreshAccessToken();

      expect(token).toBe('locked-token');
      // Acquired the stable cross-tab lock name, exclusively, with a timeout signal.
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(requestMock.mock.calls[0][0]).toBe('tehus-auth-refresh');
      expect(requestMock.mock.calls[0][1]).toMatchObject({ mode: 'exclusive' });

      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'locks');
    });

    it('falls back to an unlocked refresh when Web Locks is unavailable (no loop)', async () => {
      // Ensure no Web Locks on navigator.
      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'locks');
      mockedPost.mockResolvedValue({ data: { token: 'fallback-token' } });

      const { refreshAccessToken } = await import('./axios');
      const token = await refreshAccessToken();

      expect(token).toBe('fallback-token');
      expect(refreshCallCount()).toBe(1);
    });

    it('falls back to an unlocked refresh if acquiring the lock times out (abort)', async () => {
      // A lock manager that rejects with an AbortError (as a timeout would).
      const requestMock = vi.fn(async (_n: string, opts: { signal?: AbortSignal }) => {
        const err = new DOMException('aborted', 'AbortError');
        // Simulate the abort path.
        if (opts?.signal) throw err;
        throw err;
      });
      Object.defineProperty(navigator, 'locks', {
        value: { request: requestMock },
        writable: true,
        configurable: true,
      });
      mockedPost.mockResolvedValue({ data: { token: 'after-timeout-token' } });

      const { refreshAccessToken } = await import('./axios');
      const token = await refreshAccessToken();

      // Lock failed → unlocked refresh still succeeded.
      expect(token).toBe('after-timeout-token');
      Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'locks');
    });
  });
});
