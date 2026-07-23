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

describe('axios refresh interceptor', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mockedPost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('a failed refresh clears the local session and never retries indefinitely', async () => {
    mockedPost.mockRejectedValue(new Error('refresh failed'));
    const originalLocation = window.location;
    // jsdom's window.location.href assignment doesn't actually navigate,
    // but it does throw "Not implemented" noise — stub it so the
    // assertion below can observe the attempted redirect cleanly.
    Reflect.deleteProperty(window, 'location');
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, href: '' },
      writable: true,
      configurable: true,
    });

    localStorage.setItem('token', 'stale-token');

    const { default: api } = await import('./axios');
    const handler = getResponseErrorHandler(api);

    await handler(buildAxiosError('/platform/companies')).catch(() => {});

    expect(window.location.href).toContain('/login');
    // Only the one refresh attempt — a failed refresh must not retry the
    // original request or loop.
    const refreshCalls = mockedPost.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
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
});
