import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { ModoDemoService } from '../../common/demo/modo-demo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import { WhatsAppEmbeddedSignupStateService } from './whatsapp-embedded-signup-state.service';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private integrationService: WhatsAppIntegrationService,
    private management: WhatsAppIntegrationManagementService,
    private notifications: NotificationsService,
    private readonly modoDemo: ModoDemoService,
  ) {}

  // Notifies the company's admins about a WhatsApp connection event.
  private notifyAdmins(
    companyId: string,
    type:
      | 'WHATSAPP_CONNECTED'
      | 'WHATSAPP_CONNECTION_FAILED'
      | 'WHATSAPP_DISCONNECTED',
    title: string,
  ): void {
    void this.notifications.emitToCompanyRoles(
      companyId,
      ['ADMIN', 'SUPER_ADMIN'],
      {
        type,
        title,
        entityType: 'WhatsAppIntegration',
        actionUrl: '/dashboard/settings/whatsapp',
      },
    );
  }

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
    await this.modoDemo.bloquearSiDemo(companyId, 'conectar WhatsApp con Meta');

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
      action: 'WHATSAPP_SIGNUP_STARTED',
      entityType: ENTITY,
      ipAddress: actor.ipPreview,
      userAgent: actor.userAgent,
    });

    return { ...config, state, expiresAt };
  }

  async reconnect(companyId: string, actor: SignupActor) {
    await this.modoDemo.bloquearSiDemo(
      companyId,
      'reconectar WhatsApp con Meta',
    );

    this.assertEnabled();
    const config = this.publicConfig();
    // Reconnect simply issues a NEW single-use state. The existing integration
    // is deliberately left untouched (still CONNECTED) so that if the user
    // cancels the Meta popup, the company is not left disconnected — the state
    // is only replaced by a successful `complete`.
    const { state, expiresAt } = await this.stateService.issueForCompany(
      companyId,
      actor.userId,
      actor.ipPreview,
    );

    await this.auditLog.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      affectedCompanyId: companyId,
      action: 'WHATSAPP_RECONNECTED',
      entityType: ENTITY,
      ipAddress: actor.ipPreview,
      userAgent: actor.userAgent,
    });

    return { ...config, state, expiresAt };
  }

  // Local-only disconnect (does NOT revoke on Meta, does NOT deregister the
  // number — Coexistence stays intact). Audited as a local action.
  async disconnectLocal(companyId: string, actor: SignupActor) {
    const result = await this.management.disconnectForCompany(companyId);
    await this.auditLog.record(this.prisma, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      affectedCompanyId: companyId,
      action: 'WHATSAPP_DISCONNECTED_LOCAL',
      entityType: ENTITY,
      ipAddress: actor.ipPreview,
      userAgent: actor.userAgent,
    });
    this.notifyAdmins(
      companyId,
      'WHATSAPP_DISCONNECTED',
      'WhatsApp se desconectó en el CRM (no se revocó en Meta).',
    );
    return result;
  }

  // Sends a single explicit connection-test text message to an E.164 number,
  // reusing the company's connected integration. Only works inside Meta's
  // allowed conversation window (no template) — a closed window yields a
  // generic error. Never returns the raw Meta response.
  async sendTest(companyId: string, actor: SignupActor, to: string) {
    await this.modoDemo.bloquearSiDemo(
      companyId,
      'enviar un mensaje de prueba',
    );

    this.assertEnabled();
    const integration =
      await this.integrationService.findConnectedByCompanyId(companyId);
    if (!integration || !integration.accessTokenEncrypted) {
      throw new BadRequestException(
        'WhatsApp no está conectado para esta empresa.',
      );
    }
    let ok = false;
    try {
      const token = this.tokenCrypto.decrypt(integration.accessTokenEncrypted);
      await this.metaClient.sendText(
        integration.phoneNumberId,
        token,
        to,
        'Mensaje de prueba de conexión desde TAKTO. Puedes ignorarlo.',
      );
      ok = true;
      return { status: 'ok' as const };
    } catch (error) {
      throw this.toClientError(error);
    } finally {
      await this.auditLog
        .record(this.prisma, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          affectedCompanyId: companyId,
          action: 'WHATSAPP_CONNECTION_TESTED',
          entityType: ENTITY,
          reason: ok ? 'ok' : 'failed',
          ipAddress: actor.ipPreview,
          userAgent: actor.userAgent,
        })
        .catch(() => undefined);
    }
  }

  async complete(
    companyId: string,
    actor: SignupActor,
    dto: EmbeddedSignupCompleteDto,
  ) {
    await this.modoDemo.bloquearSiDemo(companyId, 'conectar WhatsApp con Meta');
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

      // is_on_biz_app is Meta's authoritative coexistence flag. Keep the
      // platform-type fallback for older Graph responses that omit the field.
      const isCoexistence =
        match.isOnBizApp === true ||
        this.looksLikeCoexistence(match.platformType);

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
        // Clave por phoneNumberId, que es unico GLOBAL: reconectar el mismo
        // numero lo actualiza, y conectar uno distinto anade una segunda
        // integracion a la empresa. Antes se hacia por companyId, lo que solo
        // funcionaba con un numero por empresa.
        const saved = await tx.whatsAppIntegration.upsert({
          where: { phoneNumberId: dto.phoneNumberId },
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
          action: 'WHATSAPP_SIGNUP_COMPLETED',
          entityType: ENTITY,
          entityId: saved.id,
          // Non-secret metadata only.
          metadata: { connectionMethod: method },
          ipAddress: actor.ipPreview,
          userAgent: actor.userAgent,
        });

        return saved;
      });

      this.notifyAdmins(
        companyId,
        'WHATSAPP_CONNECTED',
        'WhatsApp Business quedó conectado correctamente.',
      );
      return this.toSafeStatus(integration);
    } catch (error) {
      await this.recordFailure(companyId, actor, error);
      this.notifyAdmins(
        companyId,
        'WHATSAPP_CONNECTION_FAILED',
        'No se pudo completar la conexión de WhatsApp con Meta.',
      );
      throw this.toClientError(error);
    }
  }

  async getConnectionStatus(companyId: string) {
    // Con varios numeros por empresa se resuelve la PRINCIPAL.
    const integration = await this.prisma.whatsAppIntegration.findFirst({
      where: { companyId },
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    if (integration) {
      return this.toSafeStatus(integration);
    }

    const connecting = await this.stateService.hasActiveState(companyId);
    return {
      status: connecting ? 'CONNECTING' : 'NOT_CONNECTED',
      connectionMethod: null,
      coexistence: false,
      maskedPhoneNumber: null,
      businessName: null,
      connectedAt: null,
      lastCheckedAt: null,
      webhookStatus: 'UNKNOWN',
      actionRequired: false,
      errorCode: null,
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
        action: 'WHATSAPP_SIGNUP_FAILED',
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
    lastErrorCode?: string | null;
  }) {
    const status =
      integration.status === 'PENDING' ? 'NOT_CONNECTED' : integration.status;
    // The WABA is subscribed to the app as part of a successful `complete`, so a
    // CONNECTED integration implies the webhook is subscribed. Anything else is
    // reported as UNKNOWN (we never track raw webhook payloads).
    const webhookStatus = status === 'CONNECTED' ? 'SUBSCRIBED' : 'UNKNOWN';
    const actionRequired = ['REAUTH_REQUIRED', 'ERROR', 'REVOKED'].includes(
      status,
    );
    return {
      status,
      connectionMethod: integration.connectionMethod,
      coexistence: integration.connectionMethod === 'COEXISTENCE',
      maskedPhoneNumber: this.maskPhone(integration.displayPhoneNumber),
      businessName: integration.businessName,
      connectedAt: integration.connectedAt,
      lastCheckedAt: integration.lastCheckedAt,
      webhookStatus,
      actionRequired,
      // Already a redacted, non-secret classifier (or null).
      errorCode: integration.lastErrorCode ?? null,
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
