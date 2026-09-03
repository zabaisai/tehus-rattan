import { AppThrottlerGuard } from './app-throttler.guard';
import {
  DEVICE_ID_COOKIE,
  LEGACY_DEVICE_ID_COOKIE,
} from '../../modules/sessions/sessions.constants';

// getTracker is protected; same access trick as app-throttler.guard.spec.ts.
type Exposed = { getTracker(req: Record<string, unknown>): Promise<string> };
const guard = Object.create(AppThrottlerGuard.prototype) as Exposed;

const req = (overrides: Record<string, unknown>) => ({
  originalUrl: '/api/auth/refresh',
  ip: '10.0.0.1',
  ips: [],
  ...overrides,
});

// Fase 1: el cubo de /auth/refresh sigue siendo el MISMO dispositivo aunque
// el navegador todavía envíe la cookie con el nombre antiguo.
describe('AppThrottlerGuard — cookie de dispositivo legacy', () => {
  it('la cookie legacy produce el mismo cubo que la canónica con el mismo valor', async () => {
    const canonical = await guard.getTracker(
      req({ cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }),
    );
    const legacy = await guard.getTracker(
      req({ cookies: { [LEGACY_DEVICE_ID_COOKIE]: 'device-A' } }),
    );
    expect(legacy).toBe(canonical);
    expect(legacy.startsWith('rt-dev:')).toBe(true);
    expect(legacy).not.toContain('device-A');
  });

  it('con ambas cookies manda la canónica', async () => {
    const both = await guard.getTracker(
      req({
        cookies: {
          [DEVICE_ID_COOKIE]: 'device-A',
          [LEGACY_DEVICE_ID_COOKIE]: 'device-B',
        },
      }),
    );
    const onlyA = await guard.getTracker(
      req({ cookies: { [DEVICE_ID_COOKIE]: 'device-A' } }),
    );
    expect(both).toBe(onlyA);
  });

  it('sin ninguna cookie cae al cubo por IP', async () => {
    const key = await guard.getTracker(req({ cookies: {} }));
    expect(key).toBe('10.0.0.1');
  });
});
