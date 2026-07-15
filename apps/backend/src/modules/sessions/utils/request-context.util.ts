import { DeviceType } from '@prisma/client';
import { getTrustedClientIp, truncateIp } from './ip.util';
import { parseUserAgent } from './user-agent.util';
import { hashToken } from './token.util';

export interface SessionRequestContext {
  // SHA-256 hex digest of the raw deviceId cookie value — the only form
  // ever written to Prisma. The raw cookie value itself never leaves
  // DeviceIdMiddleware/this function.
  deviceIdHash: string;
  // Already-truncated/anonymized — see ip.util.ts#truncateIp. There is no
  // corresponding "full IP" field anywhere in this context or the schema.
  ipPreview: string | null;
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
// UserSession/LoginEvent row needs. Every value that reaches Prisma here
// has already been hashed (deviceId) or truncated (IP) or reduced to a
// coarse parsed summary (user agent) — nothing precise/raw survives past
// this function.
export function buildSessionRequestContext(
  req: RequestLike,
): SessionRequestContext {
  const rawIp = getTrustedClientIp(req);
  const rawUserAgent = req.headers?.['user-agent'];
  const userAgent = typeof rawUserAgent === 'string' ? rawUserAgent : null;
  const { browser, operatingSystem, deviceType } = parseUserAgent(userAgent);

  return {
    deviceIdHash: hashToken(req.deviceId ?? 'unknown-device'),
    ipPreview: truncateIp(rawIp),
    browser,
    operatingSystem,
    deviceType,
  };
}
