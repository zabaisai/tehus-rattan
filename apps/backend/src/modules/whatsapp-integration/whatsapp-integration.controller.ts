import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from '../../common/throttle/throttle.config';
import { getTrustedClientIp, truncateIp } from '../sessions/utils/ip.util';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import {
  SignupActor,
  WhatsAppEmbeddedSignupService,
} from './whatsapp-embedded-signup.service';
import { ConnectWhatsAppIntegrationDto } from './dto/connect-whatsapp-integration.dto';
import { EmbeddedSignupCompleteDto } from './dto/embedded-signup-complete.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('whatsapp-integrations')
export class WhatsAppIntegrationController {
  constructor(
    private managementService: WhatsAppIntegrationManagementService,
    private embeddedSignupService: WhatsAppEmbeddedSignupService,
  ) {}

  @Get('me')
  getMyIntegration(@Request() req: any) {
    return this.managementService.getForCompany(req.user.companyId);
  }

  // Safe, token-free connection snapshot (phone masked). ADMIN/SUPER_ADMIN only.
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('me/connection-status')
  getConnectionStatus(@Request() req: any) {
    return this.embeddedSignupService.getConnectionStatus(req.user.companyId);
  }

  // ── Meta Embedded Signup ────────────────────────────────────

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.whatsappSignup },
  })
  @HttpCode(200)
  @Post('me/embedded-signup/start')
  startEmbeddedSignup(@Request() req: any) {
    return this.embeddedSignupService.start(
      req.user.companyId,
      this.actorFrom(req),
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.whatsappSignup },
  })
  @HttpCode(200)
  @Post('me/embedded-signup/complete')
  completeEmbeddedSignup(
    @Request() req: any,
    @Body() dto: EmbeddedSignupCompleteDto,
  ) {
    return this.embeddedSignupService.complete(
      req.user.companyId,
      this.actorFrom(req),
      dto,
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.whatsappSignup },
  })
  @HttpCode(200)
  @Post('me/reconnect')
  reconnect(@Request() req: any) {
    return this.embeddedSignupService.reconnect(
      req.user.companyId,
      this.actorFrom(req),
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('me/disconnect')
  disconnectMyIntegration(@Request() req: any) {
    return this.managementService.disconnectForCompany(req.user.companyId);
  }

  // ── Legacy manual connection (advanced, SUPER_ADMIN only) ────
  // Kept as a fallback while Embedded Signup rolls out. Deliberately restricted
  // to SUPER_ADMIN and surfaced in the UI only inside an "advanced" section.
  @Roles('SUPER_ADMIN')
  @Put('me')
  connectOrUpdateMyIntegration(
    @Request() req: any,
    @Body() dto: ConnectWhatsAppIntegrationDto,
  ) {
    return this.managementService.connectOrUpdateForCompany(
      req.user.companyId,
      dto,
    );
  }

  private actorFrom(req: any): SignupActor {
    return {
      userId: req.user.sub,
      role: req.user.role,
      ipPreview: truncateIp(getTrustedClientIp(req)),
      userAgent: req.headers?.['user-agent'] ?? null,
    };
  }
}
