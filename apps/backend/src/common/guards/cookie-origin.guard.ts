import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { buildAllowedOrigins } from '../security/allowed-origins';

// Defense-in-depth CSRF protection for the cookie-based auth POSTs
// (login / refresh / logout). The refresh cookie is already SameSite=lax, which
// blocks cross-site POSTs from carrying it; this guard adds an explicit,
// testable Origin allowlist on top.
//
// A browser always sends an Origin header on these state-changing POSTs, so:
//  - a present-but-not-allowed Origin (including the literal "null") → 403;
//  - a MISSING Origin → fail-closed (403) in production (anomalous for a
//    browser endpoint), but allowed in non-production (dev / E2E) so curl and
//    supertest keep working.
// In production, if no allowed origins are configured (no FRONTEND_URL /
// CSRF_ALLOWED_ORIGINS) the allowlist is empty and every request is rejected —
// a deliberate fail-closed on misconfiguration.
@Injectable()
export class CookieOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  private allowedOrigins(): string[] {
    // Shared with the CORS config (main.ts) so the two never drift.
    return buildAllowedOrigins({
      CSRF_ALLOWED_ORIGINS: this.config.get<string>('CSRF_ALLOWED_ORIGINS'),
      FRONTEND_URL: this.config.get<string>('FRONTEND_URL'),
      NODE_ENV: this.config.get<string>('NODE_ENV'),
    });
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const originHeader = request.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    if (!origin) {
      // Fail-closed in production (a browser would always send Origin here);
      // permit missing Origin in dev/E2E for non-browser clients.
      if (isProduction) {
        throw new ForbiddenException('Origen requerido');
      }
      return true;
    }

    if (this.allowedOrigins().includes(origin)) return true;

    throw new ForbiddenException('Origen no permitido');
  }
}
