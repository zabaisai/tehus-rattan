import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import { WhatsAppEmbeddedSignupStateService } from './whatsapp-embedded-signup-state.service';
import {
  MetaSignupError,
  WhatsAppMetaClientService,
} from './whatsapp-meta-client.service';
import { EmbeddedSignupCompleteDto } from './dto/embedded-signup-complete.dto';

export interface SignupActor {
  userId: string;
  role: Role;
  ipPreview: string | null;
  userAgent: string | null;
}

const ENTITY = 'WhatsAppIntegration';

// Orchestrates the Meta Embedded Signup flow end to end, server-side.
// The browser only ever receives public config + a single-use state, and a
// safe (token-free, phone-masked) view of the integration.
@Injectable()
export class WhatsAppEmbeddedSignupService {
  private readonly logger = new Logger(WhatsAppEmbeddedSignupService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private stateService: WhatsAppEmbeddedSignupStateService,
    private metaClient: WhatsAppMetaClientService,
    private tokenCrypto: WhatsAppTokenCryptoService,
    private auditLog: PlatformAuditLogService,
  ) {}

  private assertEnabled(): void {
    const enabled =
      this.configService.get<string>('WHATSAPP_EMBEDDED_SIGNUP_ENABLED') ===
      'true';
    if (!enabled) {
      throw new ServiceUnavailableException(
        'La conexión con Meta no está disponible en este momento.',
      );
    }
  }

  // Public config the browser needs to launch the Meta SDK. App id / config id
  // are public values; the app secret is NEVER exposed here.
  private publicConfig(): {
    appId: string;
    configId: string;
    graphVersion: string;
  } {
    return {
      appId: this.metaClient.appId(),
      configId: this.metaClient.configId(),
      graphVersion: this.metaClient.graphVersion(),
    };
  }

  async start(companyId: string, actor: SignupActor) {
    this.assertEnabled();
    const config = this.publicConfig();
    const { state, expiresAt } = await this.stateService.issueForCompany(
      companyId,
      actor.userId,
      actor.ipPreview,
    );

    await this.auditLog.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      affectedCompanyId: companyId,
      action: 'WHATSAPP_EMBEDDED_SIGNUP_STARTED',
      entityType: ENTITY,
      ipAddress: actor.ipPreview,
      userAgent: actor.userAgent,
    });

    return { ...config, state, expiresAt };
  }

  async reconnect(companyId: string, actor: SignupActor) {
    this.assertEnabled();
    const config = this.publicConfig();
    const { state, expiresAt } = await this.stateService.issueForCompany(
      companyId,
      actor.userId,
      actor.ipPreview,
    );

    // Reflect that the existing integration needs re-auth (best-effort).
    await this.prisma.whatsAppIntegration
      .updateMany({
        where: { companyId, status: { in: ['CONNECTED', 'ERROR', 'REVOKED'] } },
        data: { status: 'REAUTH_REQUIRED' },
      })
      .catch(() => undefined);

    await this.auditLog.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      affectedCompanyId: companyId,
      action: 'WHATSAPP_RECONNECT_STARTED',
      entityType: ENTITY,
      ipAddress: actor.ipPreview,
      userAgent: actor.userAgent,
    });

    return { ...config, state, expiresAt };
  }

  async complete(
    companyId: string,
    actor: SignupActor,
    dto: EmbeddedSignupCompleteDto,
  ) {
    this.assertEnabled();

    // 1) Consume the state immediately (outside the persist transaction) so it
    //    can never be replayed, even if a later step fails.
    await this.stateService.consumeForCompany(companyId, dto.state);

    try {
      // 2) Cross-tenant guard: a phoneNumberId can only ever belong to one
      //    company.
      const existingOwner = await this.prisma.whatsAppIntegration.findUnique({
        where: { phoneNumberId: dto.phoneNumberId },
        select: { companyId: true },
      });
      if (existingOwner && existingOwner.companyId !== companyId) {
        throw new ConflictException(
          'Este número de WhatsApp ya está conectado a otra empresa.',
        );
      }

      // 3) Exchange the code for a customer business token (server-side only).
      const token = await this.metaClient.exchangeCode(dto.code);

      // 4) Confirm the phoneNumberId really belongs to the authorized WABA and
      //    read its display name / platform type.
      const numbers = await this.metaClient.listPhoneNumbers(dto.wabaId, token);
      const match = numbers.find((n) => n.id === dto.phoneNumberId);
      if (!match) {
        throw new MetaSignupError('PHONE_NOT_IN_WABA');
      }

      const isCoexistence = this.looksLikeCoexistence(match.platformType);

      // 5) Subscribe the app to the WABA so inbound webhooks flow (idempotent).
      await this.metaClient.subscribeAppToWaba(dto.wabaId, token);

      // NOTE: we deliberately do NOT auto-register the phone number here.
      // Registration takes a number out of the WhatsApp Business app and needs
      // the customer's 2FA PIN; doing it automatically would break coexistence
      // numbers. Registration, when needed for a brand-new Cloud API number, is
      // handled as an explicit, separately-confirmed step (see docs).

      // 6) Persist atomically + audit in the same transaction.
      const accessTokenEncrypted = this.tokenCrypto.encrypt(token);
      const connectedAt = new Date();
      const method = isCoexistence ? 'COEXISTENCE' : 'EMBEDDED_SIGNUP';

      const integration = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.whatsAppIntegration.upsert({
          where: { companyId },
          create: {
            companyId,
            phoneNumberId: dto.phoneNumberId,
            displayPhoneNumber: match.displayPhoneNumber ?? null,
            wabaId: dto.wabaId,
            businessId: dto.businessId ?? null,
            businessName: match.verifiedName ?? null,
            accessTokenEncrypted,
            status: 'CONNECTED',
            connectionMethod: method,
            connectedAt,
            disconnectedAt: null,
            lastCheckedAt: connectedAt,
            lastErrorCode: null,
          },
          update: {
            phoneNumberId: dto.phoneNumberId,
            displayPhoneNumber: match.displayPhoneNumber ?? null,
            wabaId: dto.wabaId,
            businessId: dto.businessId ?? null,
            businessName: match.verifiedName ?? null,
            accessTokenEncrypted,
            status: 'CONNECTED',
            connectionMethod: method,
            connectedAt,
            disconnectedAt: null,
            lastCheckedAt: connectedAt,
            lastErrorCode: null,
          },
        });

        await this.auditLog.record(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          affectedCompanyId: companyId,
          action: 'WHATSAPP_EMBEDDED_SIGNUP_COMPLETED',
          entityType: ENTITY,
          entityId: saved.id,
          // Non-secret metadata only.
          metadata: { connectionMethod: method },
          ipAddress: actor.ipPreview,
          userAgent: actor.userAgent,
        });

        return saved;
      });

      return this.toSafeStatus(integration);
    } catch (error) {
      await this.recordFailure(companyId, actor, error);
      throw this.toClientError(error);
    }
  }

  async getConnectionStatus(companyId: string) {
    const integration = await this.prisma.whatsAppIntegration.findUnique({
      where: { companyId },
    });
    if (integration) {
      return this.toSafeStatus(integration);
    }

    const connecting = await this.stateService.hasActiveState(companyId);
    return {
      status: connecting ? 'CONNECTING' : 'NOT_CONNECTED',
      connectionMethod: null,
      maskedPhoneNumber: null,
      businessName: null,
      connectedAt: null,
      lastCheckedAt: null,
    };
  }

  // ── helpers ────────────────────────────────────────────────

  private looksLikeCoexistence(platformType?: string): boolean {
    if (!platformType) return false;
    return /coexist|business_app|on_biz|smb_app/i.test(platformType);
  }

  private async recordFailure(
    companyId: string,
    actor: SignupActor,
    error: unknown,
  ): Promise<void> {
    const classifier =
      error instanceof MetaSignupError
        ? error.classifier
        : error instanceof ConflictException
          ? 'PHONE_OWNED_BY_OTHER_COMPANY'
          : 'UNKNOWN';
    try {
      await this.prisma.whatsAppIntegration.updateMany({
        where: { companyId },
        data: { status: 'ERROR', lastErrorCode: classifier },
      });
      await this.auditLog.record(this.prisma, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        affectedCompanyId: companyId,
        action: 'WHATSAPP_EMBEDDED_SIGNUP_FAILED',
        entityType: ENTITY,
        reason: classifier,
        ipAddress: actor.ipPreview,
        userAgent: actor.userAgent,
      });
    } catch {
      this.logger.warn(
        `Failed to record embedded-signup failure [${classifier}]`,
      );
    }
  }

  // Map internal errors to safe, generic client errors. Never leak Meta detail.
  private toClientError(error: unknown): Error {
    if (error instanceof ConflictException) return error;
    if (error instanceof MetaSignupError) {
      return new BadRequestException(
        'No se pudo completar la conexión con Meta. Inténtalo de nuevo.',
      );
    }
    if (error instanceof BadRequestException) return error;
    return new BadRequestException(
      'No se pudo completar la conexión con Meta. Inténtalo de nuevo.',
    );
  }

  private toSafeStatus(integration: {
    status: string;
    connectionMethod: string;
    displayPhoneNumber: string | null;
    businessName: string | null;
    connectedAt: Date | null;
    lastCheckedAt: Date | null;
  }) {
    const status =
      integration.status === 'PENDING' ? 'NOT_CONNECTED' : integration.status;
    return {
      status,
      connectionMethod: integration.connectionMethod,
      maskedPhoneNumber: this.maskPhone(integration.displayPhoneNumber),
      businessName: integration.businessName,
      connectedAt: integration.connectedAt,
      lastCheckedAt: integration.lastCheckedAt,
    };
  }

  // "+57 300 *** 4521" style masking — keeps only the last 4 digits.
  private maskPhone(display: string | null): string | null {
    if (!display) return null;
    const digits = display.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    const last4 = digits.slice(-4);
    return `••• ${last4}`;
  }
}
