import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SessionsService,
  LoginFailureReason,
} from '../sessions/sessions.service';
import { SessionRequestContext } from '../sessions/utils/request-context.util';
import * as bcrypt from 'bcryptjs';
import { DeviceVerificationConfig } from './device-verification/device-verification.config';
import {
  DeviceVerificationService,
  type ChallengeView,
} from './device-verification/device-verification.service';
import { TrustedDeviceService } from './device-verification/trusted-device.service';

/**
 * Resultado de un intento de acceso (Fase 4.5).
 *
 * Unión discriminada a propósito: el controlador no puede confundir «hay
 * sesión» con «falta verificar», y cuando falta verificar no existe token ni
 * refresh token que devolver.
 */
export type LoginOutcome =
  | {
      outcome: 'authenticated';
      token: string;
      user: { id: string; email: string; name: string };
      refreshToken: string;
    }
  | { outcome: 'verification_required'; challenge: ChallengeView };

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private sessionsService: SessionsService,
    private deviceVerificationConfig: DeviceVerificationConfig,
    private deviceVerification: DeviceVerificationService,
    private trustedDevices: TrustedDeviceService,
  ) {}

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
    const user = await this.authenticate(email, password, context);

    if (!context) {
      return this.issueSession(user);
    }

    return this.startSession(user, context);
  }

  /**
   * Acceso con verificación de dispositivo (Fase 4.5).
   *
   * Valida las credenciales EXACTAMENTE igual que `login` —mismos errores,
   * mismos eventos de fallo, misma respuesta ante una cuenta que no existe— y
   * solo entonces decide si este dispositivo necesita un código. Con el
   * interruptor apagado, o si la cuenta queda fuera del despliegue controlado,
   * el camino es el de siempre. Cuando hace falta verificar NO se crea sesión:
   * se devuelve el reto y nada más.
   */
  async loginWithDeviceVerification(
    email: string,
    password: string,
    context: SessionRequestContext,
    trustedDeviceToken: string | null,
  ): Promise<LoginOutcome> {
    const user = await this.authenticate(email, password, context);

    const necesitaVerificar =
      this.deviceVerificationConfig.appliesTo(user.email) &&
      !(await this.trustedDevices.isTrusted(user.id, trustedDeviceToken));

    if (!necesitaVerificar) {
      const sesion = await this.startSession(user, context);
      return { outcome: 'authenticated', ...sesion };
    }

    const challenge = await this.deviceVerification.createChallenge({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      },
      context,
    });
    return { outcome: 'verification_required', challenge };
  }

  /**
   * Consume el reto y ABRE la sesión. Es el único punto donde nace una sesión
   * en el camino verificado: sin código correcto no hay token ni cookie.
   */
  async completeDeviceVerification(input: {
    challengeId: string;
    code: string;
    trustDevice: boolean;
    context: SessionRequestContext;
  }): Promise<{
    token: string;
    user: { id: string; email: string; name: string };
    refreshToken: string;
    trustedDeviceToken: string | null;
  }> {
    const verificado = await this.deviceVerification.verifyChallenge({
      challengeId: input.challengeId,
      code: input.code,
      context: input.context,
    });

    // La cuenta o la empresa pudieron cambiar de estado entre el envío del
    // código y su uso: se vuelve a comprobar antes de abrir nada.
    const user = await this.prisma.user.findUnique({
      where: { id: verificado.id },
      include: { company: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.company) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      if (user.company.status === 'SUSPENDED') {
        throw new UnauthorizedException('La empresa está suspendida');
      }
      if (user.company.status === 'DELETED') {
        throw new UnauthorizedException('La empresa fue eliminada');
      }
    }

    const sesion = await this.startSession(user, input.context);
    const trustedDeviceToken = input.trustDevice
      ? await this.trustedDevices.trustDevice({
          user: { id: user.id, role: user.role, companyId: user.companyId },
          context: input.context,
        })
      : null;

    return { ...sesion, trustedDeviceToken };
  }

  /** Reenvía el código del reto en curso (con su espera mínima). */
  async resendDeviceVerification(
    challengeId: string,
    context: SessionRequestContext,
  ): Promise<ChallengeView> {
    return this.deviceVerification.resendChallenge({ challengeId, context });
  }

  /** Crea la sesión y emite el par de tokens. */
  private async startSession(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      companyId: string | null;
    },
    context: SessionRequestContext,
  ) {
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

  /**
   * Credenciales y estado de la cuenta y de la empresa.
   *
   * Es la mitad de `login` que el camino verificado reutiliza tal cual, para
   * que no existan dos listas de comprobaciones capaces de divergir.
   */
  private async authenticate(
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

    return user;
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
