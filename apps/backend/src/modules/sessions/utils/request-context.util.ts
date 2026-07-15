import { DeviceType } from '@prisma/client';
import { getTrustedClientIp, maskIp } from './ip.util';
import { parseUserAgent } from './user-agent.util';

export interface SessionRequestContext {
  deviceId: string;
  ipAddress: string | null;
  ipPreview: string | null;
  userAgent: string | null;
  browser: string | null;
  operatingSystem: string | null;
  deviceType: DeviceType;
}

interface RequestLike {
  deviceId?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}

// Single place that turns a raw Express request into everything a
// UserSession/LoginEvent row needs — deviceId, trusted IP (+ masked
// preview), and parsed browser/OS/device type.
export function buildSessionRequestContext(
  req: RequestLike,
): SessionRequestContext {
  const ipAddress = getTrustedClientIp(req);
  const rawUserAgent = req.headers?.['user-agent'];
  const userAgent = typeof rawUserAgent === 'string' ? rawUserAgent : null;
  const { browser, operatingSystem, deviceType } = parseUserAgent(userAgent);

  return {
    deviceId: req.deviceId ?? 'unknown-device',
    ipAddress,
    ipPreview: maskIp(ipAddress),
    userAgent,
    browser,
    operatingSystem,
    deviceType,
  };
}
