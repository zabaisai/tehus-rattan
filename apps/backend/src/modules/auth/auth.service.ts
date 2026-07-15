import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SessionsService,
  LoginFailureReason,
} from '../sessions/sessions.service';
import { SessionRequestContext } from '../sessions/utils/request-context.util';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private sessionsService: SessionsService,
  ) {}

  async register(data: {
    companyName: string;
    name: string;
    email: string;
    password: string;
  }) {
    const exists = await this.usersService.findByEmail(data.email);
    if (exists) throw new ConflictException('El email ya está registrado');

    const company = await this.prisma.company.create({
      data: { name: data.companyName },
    });

    const user = await this.usersService.create({
      email: data.email,
      password: data.password,
      name: data.name,
      companyId: company.id,
      role: 'ADMIN',
    });

    return this.issueSession(user);
  }

  // Overloaded so the return type is precise at each call site: passing a
  // `context` (the only thing AuthController.login does) statically
  // guarantees a `refreshToken` comes back, while every other/older caller
  // that omits it keeps getting exactly the old `{ token, user }` shape.
  async login(
    email: string,
    password: string,
  ): Promise<{
    token: string;
    user: { id: string; email: string; name: string };
  }>;
  async login(
    email: string,
    password: string,
    context: SessionRequestContext,
  ): Promise<{
    token: string;
    user: { id: string; email: string; name: string };
    refreshToken: string;
  }>;
  async login(
    email: string,
    password: string,
    context?: SessionRequestContext,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const recordFailure = (
      failureReason: LoginFailureReason,
      userId?: string,
      companyId?: string | null,
    ) => {
      if (!context) return;
      // Never awaited into the error path on purpose — a login rejection
      // must reach the client at the same speed whether or not the audit
      // write succeeds, and it must never turn a real login failure into a
      // 500 if this insert has a problem.
      this.sessionsService
        .recordLoginFailure({
          emailAttempted: normalizedEmail,
          userId,
          companyId,
          failureReason,
          context,
        })
        .catch(() => {});
    };

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { company: true },
    });
    if (!user) {
      recordFailure('INVALID_CREDENTIALS');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      recordFailure('INVALID_CREDENTIALS', user.id, user.companyId);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.isActive) {
      recordFailure('ACCOUNT_INACTIVE', user.id, user.companyId);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.role !== 'SUPER_ADMIN') {
      if (!user.company) {
        recordFailure('INVALID_CREDENTIALS', user.id, user.companyId);
        throw new UnauthorizedException('Credenciales inválidas');
      }
      if (user.company.status === 'SUSPENDED') {
        recordFailure('COMPANY_SUSPENDED', user.id, user.companyId);
        throw new UnauthorizedException('La empresa está suspendida');
      }
      if (user.company.status === 'DELETED') {
        recordFailure('COMPANY_DELETED', user.id, user.companyId);
        throw new UnauthorizedException('La empresa fue eliminada');
      }
    }

    if (!context) {
      return this.issueSession(user);
    }

    const { sessionId, refreshToken } =
      await this.sessionsService.recordLoginSuccess({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
        },
        context,
      });

    return { ...this.issueSession(user, sessionId), refreshToken };
  }

  async me(userId: string) {
    return this.usersService.findById(userId);
  }

  // Shared by login, register, and onboarding (which mints a session for the
  // admin it just created) so token issuance stays in exactly one place.
  // `sessionId`, when provided, is embedded as `sid` so
  // ActivityThrottleInterceptor can cheaply attribute later requests to a
  // UserSession without a DB lookup — tokens minted without one (register,
  // onboarding) simply have no `sid` and that interceptor no-ops for them.
  issueSession(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      companyId: string | null;
    },
    sessionId?: string,
  ) {
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      ...(sessionId ? { sid: sessionId } : {}),
    });

    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }

  // Called by /auth/refresh — see AuthController for the cookie handling.
  async refresh(
    plainRefreshToken: string | undefined,
    context: SessionRequestContext,
  ) {
    // A missing cookie (never logged in, already logged out, cleared by
    // the browser) is rejected the same generic way as an unknown/revoked/
    // expired one — hashToken() requires a string, so this must be checked
    // before ever reaching SessionsService.
    if (!plainRefreshToken)
      throw new UnauthorizedException('Sesión inválida o expirada');

    const rotated = await this.sessionsService.rotateRefreshToken(
      plainRefreshToken,
      context,
    );
    if (!rotated) throw new UnauthorizedException('Sesión inválida o expirada');

    return {
      ...this.issueSession(rotated.user, rotated.sessionId),
      refreshToken: rotated.refreshToken,
    };
  }

  // Called by /auth/logout — closes only the one session identified by the
  // refresh-token cookie. A request with no/invalid cookie is a silent
  // no-op: logging out is always "successful" from the client's point of
  // view, since local session state gets cleared either way.
  async logout(plainRefreshToken: string | undefined): Promise<void> {
    if (!plainRefreshToken) return;
    await this.sessionsService.closeSessionByRefreshToken(plainRefreshToken);
  }
}
