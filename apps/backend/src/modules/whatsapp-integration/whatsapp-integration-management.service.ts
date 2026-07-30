import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';
import {
  MetaSignupError,
  WhatsAppMetaClientService,
} from './whatsapp-meta-client.service';

const ENTITY = 'WhatsAppIntegration';

interface ConnectWhatsAppIntegrationInput {
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber?: string;
  wabaId: string;
}

// Who performed the manual connection. Only non-secret, already-redacted
// values (the IP arrives truncated) — never a token. Mirrors SignupActor,
// redeclared here so this service does not import the Embedded Signup service
// (which imports this one).
export interface ManualConnectActor {
  userId: string;
  role: Role;
  ipPreview?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class WhatsAppIntegrationManagementService {
  constructor(
    private prisma: PrismaService,
    private tokenCryptoService: WhatsAppTokenCryptoService,
    private metaClient: WhatsAppMetaClientService,
    private auditLog: PlatformAuditLogService,
  ) {}

  async getForCompany(companyId: string) {
    const trimmedCompanyId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const integration = await this.prisma.whatsAppIntegration.findUnique({
      where: { companyId: trimmedCompanyId },
    });

    if (!integration) return null;

    return this.toSafeResponse(integration);
  }

  // Manual (SUPER_ADMIN-only) connection. Mirrors the guarantees the Embedded
  // Signup `complete` already gives: the credentials are proven against Meta
  // BEFORE anything is written, the app is subscribed to the WABA so inbound
  // webhooks actually flow, and the write + audit happen in one transaction.
  // The plain token never leaves this method and is never logged or audited.
  async connectOrUpdateForCompany(
    companyId: string,
    input: ConnectWhatsAppIntegrationInput,
    actor: ManualConnectActor,
  ) {
    const trimmedCompanyId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );
    const phoneNumberId = this.requireNonBlank(
      input.phoneNumberId,
      'phoneNumberId no puede estar vacio',
    );
    const accessToken = this.requireNonBlank(
      input.accessToken,
      'accessToken no puede estar vacio',
    );
    const wabaId = this.requireNonBlank(
      input.wabaId,
      'wabaId no puede estar vacio',
    );
    const displayPhoneNumber = input.displayPhoneNumber?.trim() || undefined;

    // Cross-tenant guards run BEFORE any Meta call, so a number or a WABA that
    // belongs to another company is rejected without touching the network.
    await this.assertNotOwnedByAnotherCompany(
      { phoneNumberId },
      trimmedCompanyId,
      'Este phoneNumberId ya está conectado a otra empresa',
    );
    await this.assertNotOwnedByAnotherCompany(
      { wabaId },
      trimmedCompanyId,
      'Esta WABA ya está conectada a otra empresa',
    );

    try {
      // Proves the token is valid AND that the number really belongs to this
      // WABA — one call answers both. A bad token fails here, before any write.
      const numbers = await this.metaClient.listPhoneNumbers(
        wabaId,
        accessToken,
      );
      const match = numbers.find((n) => n.id === phoneNumberId);
      if (!match) {
        throw new MetaSignupError('PHONE_NOT_IN_WABA');
      }

      // Without this the callback stays verified but Meta delivers nothing.
      // Idempotent on Meta's side.
      await this.metaClient.subscribeAppToWaba(wabaId, accessToken);

      const accessTokenEncrypted = this.tokenCryptoService.encrypt(accessToken);
      const connectedAt = new Date();
      const resolvedDisplayPhone =
        match.displayPhoneNumber ?? displayPhoneNumber ?? null;

      const integration = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.whatsAppIntegration.upsert({
          where: { companyId: trimmedCompanyId },
          create: {
            companyId: trimmedCompanyId,
            phoneNumberId,
            displayPhoneNumber: resolvedDisplayPhone,
            wabaId,
            businessName: match.verifiedName ?? null,
            accessTokenEncrypted,
            status: 'CONNECTED',
            connectionMethod: 'MANUAL',
            connectedAt,
            disconnectedAt: null,
            lastCheckedAt: connectedAt,
            lastErrorCode: null,
          },
          update: {
            phoneNumberId,
            displayPhoneNumber: resolvedDisplayPhone,
            wabaId,
            businessName: match.verifiedName ?? null,
            accessTokenEncrypted,
            status: 'CONNECTED',
            connectionMethod: 'MANUAL',
            connectedAt,
            disconnectedAt: null,
            lastCheckedAt: connectedAt,
            lastErrorCode: null,
          },
        });

        await this.auditLog.record(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          affectedCompanyId: trimmedCompanyId,
          action: 'WHATSAPP_MANUAL_CONNECTED',
          entityType: ENTITY,
          entityId: saved.id,
          // Non-secret metadata only — never the token, never the raw number.
          metadata: { connectionMethod: 'MANUAL' },
          ipAddress: actor.ipPreview,
          userAgent: actor.userAgent,
        });

        return saved;
      });

      return this.toSafeResponse(integration);
    } catch (error) {
      throw this.toClientError(error);
    }
  }

  async disconnectForCompany(companyId: string) {
    const trimmedCompanyId = this.requireNonBlank(
      companyId,
      'companyId no puede estar vacio',
    );

    const integration = await this.prisma.whatsAppIntegration.findUnique({
      where: { companyId: trimmedCompanyId },
    });

    if (!integration) {
      throw new NotFoundException('WhatsApp no conectado para esta empresa');
    }

    const updated = await this.prisma.whatsAppIntegration.update({
      where: { companyId: trimmedCompanyId },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
      },
    });

    return this.toSafeResponse(updated);
  }

  // A phoneNumberId or a WABA may only ever belong to ONE company. Re-running
  // the connection for the company that already owns it is allowed (that is a
  // credential refresh, not a takeover).
  private async assertNotOwnedByAnotherCompany(
    where: { phoneNumberId: string } | { wabaId: string },
    companyId: string,
    message: string,
  ): Promise<void> {
    const owner = await this.prisma.whatsAppIntegration.findFirst({
      where,
      select: { companyId: true },
    });
    if (owner && owner.companyId !== companyId) {
      throw new ConflictException(message);
    }
  }

  // Meta failures are surfaced to the caller as a generic message. The
  // MetaSignupError classifier is already redacted, and the raw Meta response
  // (which can echo the token) never reaches this layer.
  private toClientError(error: unknown): Error {
    if (error instanceof ConflictException) return error;
    if (error instanceof BadRequestException) return error;
    if (error instanceof MetaSignupError) {
      return new BadRequestException(
        'No se pudo validar la conexión con Meta. Revisa el Phone Number ID, el WABA ID y el token.',
      );
    }
    return new BadRequestException(
      'No se pudo completar la conexión manual de WhatsApp.',
    );
  }

  private requireNonBlank(value: string | undefined, message: string): string {
    if (!value?.trim()) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }

  private toSafeResponse(integration: {
    id: string;
    companyId: string;
    displayPhoneNumber: string | null;
    phoneNumberId: string;
    wabaId: string | null;
    status: string;
    connectedAt: Date | null;
    disconnectedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: integration.id,
      companyId: integration.companyId,
      displayPhoneNumber: integration.displayPhoneNumber,
      phoneNumberId: integration.phoneNumberId,
      wabaId: integration.wabaId,
      status: integration.status,
      connectedAt: integration.connectedAt,
      disconnectedAt: integration.disconnectedAt,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }
}
