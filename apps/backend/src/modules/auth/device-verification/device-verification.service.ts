import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { PlatformAuditLogService } from '../../platform/platform-audit-log.service';
import type { SessionRequestContext } from '../../sessions/utils/request-context.util';
import {
  digestCode,
  digestMatches,
  generateVerificationCode,
  isWellFormedCode,
  maskEmail,
} from './device-code.util';
import { DeviceVerificationConfig } from './device-verification.config';
import {
  AUDIT_CHALLENGE_CREATED,
  AUDIT_CHALLENGE_FAILED,
  AUDIT_CHALLENGE_SUCCEEDED,
  CHALLENGE_GENERIC_ERROR,
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_RESEND_COOLDOWN_MS,
  CHALLENGE_TTL_MS,
} from './device-verification.constants';

/** Lo que la API puede contar del reto. Nunca incluye el código. */
export interface ChallengeView {
  challengeId: string;
  maskedEmail: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  attemptsRemaining: number;
}

export interface ChallengeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null;
}

/**
 * Retos de verificación de dispositivo.
 *
 * Un reto NO autentica: solo se crea cuando la contraseña ya se validó, y
 * hasta que se consume no existe sesión, access token ni refresh token. Ese es
 * el invariante central de la fase.
 *
 * El código nunca se guarda ni se registra: en base vive su HMAC-SHA256 con un
 * secreto exclusivo. Los errores de verificación comparten un único mensaje
 * para no distinguir «incorrecto» de «vencido» ni de «ya usado».
 */
@Injectable()
export class DeviceVerificationService {
  private readonly logger = new Logger(DeviceVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: PlatformAuditLogService,
    private readonly config: DeviceVerificationConfig,
  ) {}

  private secretOrThrow(): string {
    const secret = this.config.hmacSecret;
    if (!secret) {
      // No debería ocurrir: `appliesTo` ya lo comprueba antes de llegar aquí.
      throw new ServiceUnavailableException(
        'La verificación de dispositivo no está disponible en este momento.',
      );
    }
    return secret;
  }

  private view(
    challenge: {
      id: string;
      expiresAt: Date;
      resendAvailableAt: Date;
      attempts: number;
      maxAttempts: number;
    },
    email: string,
  ): ChallengeView {
    return {
      challengeId: challenge.id,
      maskedEmail: maskEmail(email),
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
      attemptsRemaining: Math.max(
        0,
        challenge.maxAttempts - challenge.attempts,
      ),
    };
  }

  /**
   * Crea un reto y envía el código.
   *
   * Antes revoca los retos vivos de la misma cuenta: si alguien pide un código
   * nuevo, el anterior deja de servir en el acto. Si el correo falla, el reto
   * se revoca y se responde 503: preferimos que la persona reintente a dejar
   * un reto que nadie puede resolver.
   */
  async createChallenge(input: {
    user: ChallengeUser;
    context: SessionRequestContext;
  }): Promise<ChallengeView> {
    const secret = this.secretOrThrow();
    const { user, context } = input;
    const ahora = new Date();

    await this.revokeActiveChallenges(user.id, ahora);

    const code = generateVerificationCode();
    const challenge = await this.prisma.deviceVerificationChallenge.create({
      data: {
        userId: user.id,
        // Marcador temporal: el digest necesita el id, que aún no existe.
        codeDigest: '',
        expiresAt: new Date(ahora.getTime() + CHALLENGE_TTL_MS),
        maxAttempts: CHALLENGE_MAX_ATTEMPTS,
        resendAvailableAt: new Date(
          ahora.getTime() + CHALLENGE_RESEND_COOLDOWN_MS,
        ),
        deviceIdHash: context.deviceIdHash,
        ipPreview: context.ipPreview,
        browser: context.browser,
        operatingSystem: context.operatingSystem,
        deviceType: context.deviceType,
      },
      select: {
        id: true,
        expiresAt: true,
        resendAvailableAt: true,
        attempts: true,
        maxAttempts: true,
      },
    });

    // El digest ata el código a ESTE reto: el mismo número en otro reto no
    // coincide.
    await this.prisma.deviceVerificationChallenge.update({
      where: { id: challenge.id },
      data: { codeDigest: digestCode(code, challenge.id, secret) },
    });

    try {
      await this.mail.sendDeviceVerificationEmail({
        to: user.email,
        name: user.name,
        code,
        ttlMinutes: Math.round(CHALLENGE_TTL_MS / 60000),
      });
    } catch (error) {
      await this.prisma.deviceVerificationChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Sin código, sin destinatario, sin dirección: solo el hecho.
      this.logger.error(
        'Device verification email failed to send',
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'No pudimos enviar el código de verificación. Inténtalo de nuevo en unos minutos.',
      );
    }

    await this.recordAudit({
      user,
      action: AUDIT_CHALLENGE_CREATED,
      challengeId: challenge.id,
      context,
    });

    return this.view(challenge, user.email);
  }

  /**
   * Reenvía el código. Respeta la espera mínima, invalida el reto anterior y
   * crea uno nuevo, de modo que solo un código está vivo a la vez.
   */
  async resendChallenge(input: {
    challengeId: string;
    context: SessionRequestContext;
  }): Promise<ChallengeView> {
    const ahora = new Date();
    const challenge = await this.prisma.deviceVerificationChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        consumedAt: true,
        revokedAt: true,
        expiresAt: true,
        resendAvailableAt: true,
      },
    });

    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.revokedAt ||
      challenge.expiresAt <= ahora
    ) {
      throw new BadRequestException(CHALLENGE_GENERIC_ERROR);
    }
    if (challenge.resendAvailableAt > ahora) {
      const segundos = Math.ceil(
        (challenge.resendAvailableAt.getTime() - ahora.getTime()) / 1000,
      );
      throw new BadRequestException(
        `Espera ${segundos} segundos para pedir otro código.`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
      },
    });
    if (!user) throw new BadRequestException(CHALLENGE_GENERIC_ERROR);

    return this.createChallenge({ user, context: input.context });
  }

  /**
   * Comprueba el código y consume el reto.
   *
   * Orden deliberado: primero se descuenta el intento con una escritura
   * condicional y solo después se compara. Así dos peticiones simultáneas no
   * pueden gastar el mismo intento, y un código incorrecto cuenta aunque la
   * comparación falle. El consumo también es condicional
   * (`consumedAt IS NULL`), de modo que un mismo código nunca abre dos
   * sesiones.
   */
  async verifyChallenge(input: {
    challengeId: string;
    code: string;
    context: SessionRequestContext;
  }): Promise<ChallengeUser> {
    // Sin secreto no puede existir ningún reto válido, así que se responde el
    // MISMO error genérico que ante un código incorrecto. Un 503 aquí le
    // diría a cualquiera, sin autenticarse, si la verificación está
    // configurada en este servidor.
    const secret = this.config.hmacSecret;
    if (!secret) throw new BadRequestException(CHALLENGE_GENERIC_ERROR);
    const ahora = new Date();

    const challenge = await this.prisma.deviceVerificationChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        userId: true,
        codeDigest: true,
        expiresAt: true,
        attempts: true,
        maxAttempts: true,
        consumedAt: true,
        revokedAt: true,
      },
    });

    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.revokedAt ||
      challenge.expiresAt <= ahora ||
      challenge.attempts >= challenge.maxAttempts ||
      !isWellFormedCode(input.code)
    ) {
      throw new BadRequestException(CHALLENGE_GENERIC_ERROR);
    }

    const gastado = await this.prisma.deviceVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: ahora },
        attempts: { lt: challenge.maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (gastado.count !== 1) {
      throw new BadRequestException(CHALLENGE_GENERIC_ERROR);
    }

    const esperado = digestCode(input.code, challenge.id, secret);
    if (!digestMatches(esperado, challenge.codeDigest)) {
      await this.auditFailure(challenge.userId, challenge.id, input.context);
      throw new BadRequestException(CHALLENGE_GENERIC_ERROR);
    }

    const consumido = await this.prisma.deviceVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: ahora },
      },
      data: { consumedAt: ahora },
    });
    if (consumido.count !== 1) {
      // Otra petición idéntica ganó la carrera: este código ya se gastó.
      throw new BadRequestException(CHALLENGE_GENERIC_ERROR);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
      },
    });
    if (!user) throw new BadRequestException(CHALLENGE_GENERIC_ERROR);

    await this.recordAudit({
      user,
      action: AUDIT_CHALLENGE_SUCCEEDED,
      challengeId: challenge.id,
      context: input.context,
    });
    return user;
  }

  /** Invalida los retos vivos de una cuenta (nuevo código, o cierre de acceso). */
  async revokeActiveChallenges(userId: string, ahora = new Date()) {
    return this.prisma.deviceVerificationChallenge.updateMany({
      where: { userId, consumedAt: null, revokedAt: null },
      data: { revokedAt: ahora },
    });
  }

  private async auditFailure(
    userId: string,
    challengeId: string,
    context: SessionRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
      },
    });
    if (!user) return;
    await this.recordAudit({
      user,
      action: AUDIT_CHALLENGE_FAILED,
      challengeId,
      context,
    });
  }

  /**
   * Auditoría del reto. Guarda QUÉ pasó y en qué dispositivo aproximado, nunca
   * el código, su digest, el correo ni la IP completa.
   */
  private async recordAudit(input: {
    user: ChallengeUser;
    action: string;
    challengeId: string;
    context: SessionRequestContext;
  }): Promise<void> {
    await this.audit
      .record(this.prisma, {
        actorUserId: input.user.id,
        actorRole: input.user.role,
        affectedCompanyId: input.user.companyId,
        action: input.action,
        entityType: 'User',
        entityId: input.user.id,
        metadata: {
          challengeId: input.challengeId,
          deviceType: input.context.deviceType,
          browser: input.context.browser ?? null,
        },
        ipAddress: input.context.ipPreview ?? null,
      })
      .catch(() => undefined);
  }
}
