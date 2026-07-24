import { AppThrottlerGuard } from './app-throttler.guard';
import { DEVICE_ID_COOKIE } from '../../modules/sessions/sessions.constants';

// getTracker is protected and only uses `this` for the sibling ipTracker helper
// (no injected deps), so we can exercise it on a bare prototype instance.
const guard = Object.create(AppThrottlerGuard.prototype) as {
  getTracker(req: Record<string, unknown>): Promise<string>;
};

const req = (over: Record<string, unknown>) => ({
  originalUrl: '/api/auth/refresh',
  ip: '203.0.113.7',
  cookies: {},
  ...over,
});

describe('AppThrottlerGuard.getTracker', () => {
  it('buckets refresh by the device-id cookie the client SENT', async () => {
    const key = await guard.getTracker(
      req({ cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }),
    );
    expect(key.startsWith('rt-dev:')).toBe(true);
    // The raw device id must never appear in the bucket key (it is hashed).
    expect(key).not.toContain('device-A');
  });

  it('gives different devices different buckets, and is stable for one device', async () => {
    const a1 = await guard.getTracker(req({ cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }));
    const a2 = await guard.getTracker(req({ cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }));
    const b = await guard.getTracker(req({ cookies: { [DEVICE_ID_COOKIE]: 'device-B' } }));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('two devices behind the SAME IP do not share a refresh bucket', async () => {
    const a = await guard.getTracker(
      req({ ip: '198.51.100.1', cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }),
    );
    const b = await guard.getTracker(
      req({ ip: '198.51.100.1', cookies: { [DEVICE_ID_COOKIE]: 'device-B' } }),
    );
    expect(a).not.toBe(b);
  });

  it('falls back to IP for refresh when no device-id cookie was sent', async () => {
    const key = await guard.getTracker(req({ cookies: {} }));
    expect(key).toBe('203.0.113.7');
  });

  it('a single abusive device maps to one bucket (stays capped)', async () => {
    const keys = await Promise.all(
      Array.from({ length: 5 }, () =>
        guard.getTracker(req({ cookies: { [DEVICE_ID_COOKIE]: 'abuser' } })),
      ),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('does NOT device-bucket non-refresh routes: login stays per-IP', async () => {
    const key = await guard.getTracker(
      req({ originalUrl: '/api/auth/login', cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }),
    );
    expect(key).toBe('203.0.113.7');
  });

  it('honors the proxied client IP (req.ips[0]) for the IP fallback', async () => {
    const key = await guard.getTracker(
      req({ originalUrl: '/api/auth/login', ips: ['9.9.9.9', '10.0.0.1'] }),
    );
    expect(key).toBe('9.9.9.9');
  });
});
