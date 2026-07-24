import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

// Defense-in-depth CSRF protection for the cookie-based auth POSTs
// (login / refresh / logout). The refresh cookie is already SameSite=lax, which
// blocks cross-site POSTs from carrying it; this guard adds an explicit,
// testable Origin allowlist on top.
//
// A browser always sends an Origin header on CSRF-relevant cross-origin POSTs,
// so a present-but-not-allowed Origin is rejected (403). A MISSING Origin
// (curl, server-to-server, some same-origin navigations) is not a browser CSRF
// vector and is allowed, so non-browser API clients keep working.
@Injectable()
export class CookieOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  private allowedOrigins(): string[] {
    const origins: string[] = [];

    const explicit = this.config.get<string>('CSRF_ALLOWED_ORIGINS');
    if (explicit) {
      origins.push(
        ...explicit
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
    }

    const frontend = this.config.get<string>('FRONTEND_URL')?.trim();
    if (frontend) origins.push(frontend);

    // Convenience for local development; never in production.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      origins.push('http://localhost:3000');
    }

    return origins;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const originHeader = request.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

    if (!origin) return true;
    if (this.allowedOrigins().includes(origin)) return true;

    throw new ForbiddenException('Origen no permitido');
  }
}
