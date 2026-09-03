import { DeviceIdMiddleware } from './device-id.middleware';
import {
  DEVICE_ID_COOKIE,
  LEGACY_DEVICE_ID_COOKIE,
} from './sessions.constants';

function buildRes() {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as any;
}

// Fase 1: `tehus_device_id` → `takto_device_id` con adopción del valor.
describe('DeviceIdMiddleware — fallback de la cookie legacy', () => {
  const middleware = new DeviceIdMiddleware();

  it('nombres canónicos y legacy', () => {
    expect(DEVICE_ID_COOKIE).toBe('takto_device_id');
    expect(LEGACY_DEVICE_ID_COOKIE).toBe('tehus_device_id');
  });

  it('con solo la cookie legacy: conserva el MISMO deviceId, lo escribe con el nombre nuevo y borra el antiguo', () => {
    const req = {
      cookies: { [LEGACY_DEVICE_ID_COOKIE]: 'device-legacy' },
    } as any;
    const res = buildRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.deviceId).toBe('device-legacy');
    expect(res.cookie).toHaveBeenCalledWith(
      DEVICE_ID_COOKIE,
      'device-legacy',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(LEGACY_DEVICE_ID_COOKIE, {
      path: '/',
    });
    expect(next).toHaveBeenCalled();
  });

  it('con la cookie canónica presente no escribe ni borra nada (aunque quede una legacy)', () => {
    const req = {
      cookies: {
        [DEVICE_ID_COOKIE]: 'device-new',
        [LEGACY_DEVICE_ID_COOKIE]: 'device-legacy',
      },
    } as any;
    const res = buildRes();

    middleware.use(req, res, jest.fn());

    expect(req.deviceId).toBe('device-new');
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('sin ninguna cookie acuña un deviceId nuevo solo con el nombre canónico', () => {
    const req = { cookies: {} } as any;
    const res = buildRes();

    middleware.use(req, res, jest.fn());

    expect(typeof req.deviceId).toBe('string');
    expect(req.deviceId.length).toBeGreaterThan(0);
    const names = res.cookie.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual([DEVICE_ID_COOKIE]);
  });
});
