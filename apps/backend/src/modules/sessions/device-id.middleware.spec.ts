import { DeviceIdMiddleware } from './device-id.middleware';
import { DEVICE_ID_COOKIE } from './sessions.constants';

function buildReqRes(cookies: Record<string, string> = {}) {
  const req: any = { cookies };
  const res: any = { cookie: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('DeviceIdMiddleware', () => {
  let middleware: DeviceIdMiddleware;

  beforeEach(() => {
    middleware = new DeviceIdMiddleware();
  });

  it('generates a new deviceId and sets it as an httpOnly cookie when none is present', () => {
    const { req, res, next } = buildReqRes();

    middleware.use(req, res, next);

    expect(req.deviceId).toMatch(/^[0-9a-f]+$/);
    expect(res.cookie).toHaveBeenCalledWith(
      DEVICE_ID_COOKIE,
      req.deviceId,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('reuses the existing deviceId cookie — recognizes the same browser on a later request', () => {
    const { req, res, next } = buildReqRes({ [DEVICE_ID_COOKIE]: 'already-known-device' });

    middleware.use(req, res, next);

    expect(req.deviceId).toBe('already-known-device');
    // No new cookie is set — the browser already carries a valid one.
    expect(res.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('generates a different deviceId for two separate "browsers" (no cookie each)', () => {
    const first = buildReqRes();
    middleware.use(first.req, first.res, first.next);

    const second = buildReqRes();
    middleware.use(second.req, second.res, second.next);

    expect(first.req.deviceId).not.toBe(second.req.deviceId);
  });
});
