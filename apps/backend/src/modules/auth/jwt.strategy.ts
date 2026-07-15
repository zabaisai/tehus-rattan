import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { isSessionInactiveExpired } from '../sessions/sessions.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Runs on every authenticated request — this is what makes "revoke this
  // session" actually immediate instead of waiting out the access token's
  // own expiry. Every token minted since this check was added (login,
  // refresh, onboarding — see AuthService) carries a `sid` (UserSession
  // id); a token with no `sid` at all is rejected outright, with no
  // legacy/back-compat exception. That deliberately includes every access
  // token issued before this shipped (7-day tokens with no sid) and
  // anything from the deprecated POST /auth/register, which still mints a
  // sid-less token — both simply stop working the moment this deploys, and
  // every user must log in again. One extra indexed UserSession lookup per
  // request is an accepted cost at this app's current scale; no caching
  // layer (Redis or otherwise) was introduced for it.
  async validate(payload: {
    sub?: string;
    email?: string;
    role?: string;
    companyId?: string | null;
    sid?: string;
  }) {
    if (!payload.sid) {
      throw new UnauthorizedException('Sesión inválida');
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: {
        userId: true,
        companyId: true,
        status: true,
        revokedAt: true,
        loggedOutAt: true,
        lastSeenAt: true,
      },
    });

    // Every failure below collapses to the same generic message — which
    // specific invariant broke (missing, wrong owner, wrong company,
    // revoked, logged out, expired) is never distinguishable from the
    // response.
    if (!session) throw new UnauthorizedException('Sesión inválida');
    if (session.userId !== payload.sub)
      throw new UnauthorizedException('Sesión inválida');
    if (session.companyId !== (payload.companyId ?? null)) {
      throw new UnauthorizedException('Sesión inválida');
    }
    if (session.status !== 'ACTIVE')
      throw new UnauthorizedException('Sesión inválida');
    if (session.revokedAt) throw new UnauthorizedException('Sesión inválida');
    if (session.loggedOutAt) throw new UnauthorizedException('Sesión inválida');
    if (isSessionInactiveExpired(session.lastSeenAt)) {
      throw new UnauthorizedException('Sesión inválida');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
      sid: payload.sid,
    };
  }
}
