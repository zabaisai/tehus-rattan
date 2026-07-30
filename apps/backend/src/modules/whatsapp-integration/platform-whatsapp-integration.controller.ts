import {
  Body,
  Controller,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { PlatformGuard } from '../../common/guards/platform.guard';
import {
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from '../../common/throttle/throttle.config';
import { getTrustedClientIp, truncateIp } from '../sessions/utils/ip.util';
import { PlatformWhatsAppIntegrationService } from './platform-whatsapp-integration.service';
import { PlatformConnectWhatsAppIntegrationDto } from './dto/platform-connect-whatsapp-integration.dto';

/**
 * Platform-side, support-gated WhatsApp connection. Lives under
 * /api/platform/... and is protected by PlatformGuard, which admits ONLY a
 * SUPER_ADMIN whose `companyId` is null (a platform operator, not a company
 * user). ADMIN and AGENT cannot reach it, and neither can a SUPER_ADMIN that
 * belongs to a company.
 *
 * The target company is explicit in the path and is re-checked against the
 * caller's live support session inside the service.
 */
@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/companies/:companyId/whatsapp-integration')
export class PlatformWhatsAppIntegrationController {
  constructor(private platformService: PlatformWhatsAppIntegrationService) {}

  @Throttle({
    default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.whatsappSignup },
  })
  @Put()
  connect(
    @Param('companyId') companyId: string,
    @Body() dto: PlatformConnectWhatsAppIntegrationDto,
    @Request() req: any,
  ) {
    return this.platformService.connectForCompany(companyId, dto, {
      userId: req.user.sub,
      role: req.user.role,
      ipPreview: truncateIp(getTrustedClientIp(req)),
      userAgent: req.headers?.['user-agent'] ?? null,
    });
  }
}
