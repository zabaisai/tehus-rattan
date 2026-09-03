import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  DEVICE_ID_COOKIE,
  DEVICE_ID_COOKIE_MAX_AGE_MS,
  LEGACY_DEVICE_ID_COOKIE,
  readCookieWithLegacy,
} from './sessions.constants';
import { generateOpaqueToken } from './utils/token.util';

declare module 'express' {
  interface Request {
    deviceId?: string;
  }
}

// Runs on every request (see AppModule.configure) so a deviceId is always
// available by the time a controller runs — including the login request
// itself, before any session exists, and even failed logins (LoginEvent
// wants a deviceId too). Purely cookie-based: no fonts, canvas, screen
// resolution, or other fingerprinting signal is ever read.
@Injectable()
export class DeviceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const { value: existing, fromLegacy } = readCookieWithLegacy(
      req.cookies as Record<string, unknown> | undefined,
      DEVICE_ID_COOKIE,
      LEGACY_DEVICE_ID_COOKIE,
    );

    if (existing) {
      req.deviceId = existing;
      if (fromLegacy) {
        // Same device, new cookie name: adopt the SAME value so the device
        // keeps its identity (sessions, login events, refresh throttling
        // bucket) and retire the legacy cookie in the same response.
        this.writeCookie(res, existing);
        res.clearCookie(LEGACY_DEVICE_ID_COOKIE, { path: '/' });
      }
      next();
      return;
    }

    const deviceId = generateOpaqueToken(16);
    req.deviceId = deviceId;
    this.writeCookie(res, deviceId);
    next();
  }

  private writeCookie(res: Response, deviceId: string): void {
    res.cookie(DEVICE_ID_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: DEVICE_ID_COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
}
