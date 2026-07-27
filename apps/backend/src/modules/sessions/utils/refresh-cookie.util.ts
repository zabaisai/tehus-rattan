import type { Response } from 'express';
import {
  REFRESH_TOKEN_COOKIE,
  SESSION_INACTIVITY_EXPIRY_MS,
} from '../sessions.constants';

// Scoped to /api/auth — the only paths that ever need to read it (refresh,
// logout) — so it isn't attached to every other request the browser makes.
export const REFRESH_COOKIE_PATH = '/api/auth';

// Shared by AuthController (login/refresh) and OnboardingController (the
// admin auto-login after creating a company) so both mint the exact same
// httpOnly cookie the exact same way.
export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string,
): void {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_INACTIVITY_EXPIRY_MS,
    path: REFRESH_COOKIE_PATH,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_PATH });
}
