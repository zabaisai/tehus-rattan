import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DEVICE_ID_COOKIE, DEVICE_ID_COOKIE_MAX_AGE_MS } from './sessions.constants';
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
    const existing = req.cookies?.[DEVICE_ID_COOKIE];

    if (typeof existing === 'string' && existing.length > 0) {
      req.deviceId = existing;
      next();
      return;
    }

    const deviceId = generateOpaqueToken(16);
    req.deviceId = deviceId;

    res.cookie(DEVICE_ID_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: DEVICE_ID_COOKIE_MAX_AGE_MS,
      path: '/',
    });

    next();
  }
}
