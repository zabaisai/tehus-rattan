import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  DEVICE_ID_COOKIE,
  LEGACY_DEVICE_ID_COOKIE,
  readCookieWithLegacy,
} from '../../modules/sessions/sessions.constants';

// Global rate-limit guard. Identical to the stock ThrottlerGuard for every
// route EXCEPT the browser-only POST /auth/refresh, where it buckets by the
// device rather than by IP.
//
// Why: refresh is called by every authenticated tab. With a single per-IP
// bucket, a whole office behind one NAT/public IP shares one refresh budget, so
// a handful of colleagues reloading at once can rate-limit each other out and be
// logged of. Bucketing refresh by the httpOnly `takto_device_id` cookie gives
// each real browser its own budget, so colleagues never exhaust each other's.
//
// Abuse safety:
//  - The device-id is read from the cookie the client SENT, not the one the
//    DeviceIdMiddleware may have just minted. A client that sends no device-id
//    cookie (curl, a script, an attacker) falls back to the IP bucket, so the
//    per-device limit cannot be bypassed by simply omitting the cookie. The
//    cookie is httpOnly, so page JavaScript cannot rotate it per request.
//  - A single (honest or abusive) device still maps to exactly one bucket and
//    stays capped at the per-device limit.
//  - Login is NOT affected: only the refresh path uses device bucketing, so
//    credential brute-force protection on /auth/login remains strictly per-IP.
//
// The device-id is SHA-256-hashed before it becomes a bucket key, so the raw
// opaque identifier is never stored in the throttler store; it is never logged.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path: string = req.originalUrl ?? req.url ?? '';
    if (path.includes('/auth/refresh')) {
      // Canonical `takto_device_id`, falling back to the legacy `tehus_*`
      // name during the transition so a returning device keeps its bucket.
      const { value: sentDeviceId } = readCookieWithLegacy(
        req.cookies as Record<string, unknown> | undefined,
        DEVICE_ID_COOKIE,
        LEGACY_DEVICE_ID_COOKIE,
      );
      if (typeof sentDeviceId === 'string' && sentDeviceId.length > 0) {
        const fingerprint = createHash('sha256')
          .update(sentDeviceId)
          .digest('hex')
          .slice(0, 32);
        return `rt-dev:${fingerprint}`;
      }
    }
    return this.ipTracker(req);
  }

  // Mirrors the base guard's IP resolution, honoring the `trust proxy` hop.
  private ipTracker(req: Record<string, any>): string {
    return Array.isArray(req.ips) && req.ips.length ? req.ips[0] : req.ip;
  }
}
