import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupportSessionsService } from '../platform/support-sessions.service';
import { maskPhone } from '../../common/logging/redact';
import {
  ManualConnectActor,
  WhatsAppIntegrationManagementService,
} from './whatsapp-integration-management.service';
import { PlatformConnectWhatsAppIntegrationDto } from './dto/platform-connect-whatsapp-integration.dto';

/**
 * Support-gated manual WhatsApp connection, performed by a platform
 * SUPER_ADMIN on behalf of a company.
 *
 * This exists because the platform panel is deliberately isolated from the
 * business dashboard: a platform SUPER_ADMIN has `companyId === null`, so it
 * cannot reach /dashboard/settings/whatsapp or the in-company endpoint. That
 * isolation is NOT relaxed here. Instead this path adds a narrow, audited
 * door that opens only while a live support session for that exact company
 * exists.
 *
 * Nothing from the browser is trusted on its own:
 *  - the companyId arrives in the URL path, never in the body;
 *  - the support session is re-read server-side and must be ACTIVE, unexpired
 *    and owned by the calling actor;
 *  - the session's own companyId must equal the company in the path;
 *  - the write is then performed against the SESSION's companyId, so even a
 *    mismatch that somehow slipped through could not target another tenant.
 *
 * It grants no read access: no conversations, no messages, nothing beyond
 * writing this one integration.
 */
@Injectable()
export class PlatformWhatsAppIntegrationService {
  constructor(
    private supportSessions: SupportSessionsService,
    private management: WhatsAppIntegrationManagementService,
  ) {}

  async connectForCompany(
    companyIdFromRoute: string,
    dto: PlatformConnectWhatsAppIntegrationDto,
    actor: ManualConnectActor,
  ) {
    const companyId = companyIdFromRoute?.trim();
    if (!companyId) {
      throw new BadRequestException('companyId no puede estar vacio');
    }

    // Throws 404 if the session does not exist or belongs to another actor,
    // and 403 if it is not ACTIVE or already expired.
    const session = await this.supportSessions.validateActiveSupportSession(
      dto.supportSessionId,
      actor.userId,
    );

    // The session must cover EXACTLY this company. A valid session for
    // company A can never authorize a write to company B.
    if (session.companyId !== companyId) {
      throw new ForbiddenException(
        'La sesión de soporte no corresponde a esta empresa',
      );
    }

    // Reuses the whole hardened path: cross-tenant guards, WABA/number
    // validation against Meta, app subscription, AES-256-GCM token
    // encryption, and the atomic write + audit.
    return this.management.connectOrUpdateForCompany(
      session.companyId,
      {
        phoneNumberId: dto.phoneNumberId,
        accessToken: dto.accessToken,
        displayPhoneNumber: dto.displayPhoneNumber,
        wabaId: dto.wabaId,
      },
      actor,
      {
        action: 'WHATSAPP_MANUAL_CONNECTED_VIA_SUPPORT',
        metadata: {
          supportSessionId: session.id,
          // WHY support touched this company, as stated when the session
          // was opened.
          supportReason: session.reason,
          companyName: session.company.name,
          // Last 4 digits only — never the full number, never the token.
          maskedPhoneNumber: maskPhone(dto.displayPhoneNumber),
        },
      },
    );
  }
}
