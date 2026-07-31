import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';
import { SetRetentionDto } from './dto/set-retention.dto';
import { RequestDeletionDto } from './dto/request-deletion.dto';

/**
 * Retencion, exportacion y eliminacion de datos de la propia empresa.
 *
 * ADMIN y no AGENT: exportar el historial completo de la empresa y definir
 * cuando se borra son decisiones de quien responde por esos datos, no del uso
 * cotidiano.
 */
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('retention')
  getRetention(@Request() req: any) {
    return this.compliance.getRetention(req.user.companyId);
  }

  @Patch('retention')
  setRetention(@Request() req: any, @Body() body: SetRetentionDto) {
    return this.compliance.setRetention(req.user.companyId, body, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  /** Que se purgaria, SIN purgar. Nadie deberia activar esto sin ver el numero. */
  @Get('retention/preview')
  previewPurge(@Request() req: any) {
    return this.compliance.previewPurge(req.user.companyId);
  }

  @Post('retention/purge')
  purge(@Request() req: any) {
    return this.compliance.purge(req.user.companyId, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  @Get('export')
  exportData(@Request() req: any) {
    return this.compliance.exportCompanyData(req.user.companyId, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  /**
   * Registra la solicitud. NO borra nada: queda pendiente de aprobacion.
   */
  @Post('deletion-request')
  requestDeletion(@Request() req: any, @Body() body: RequestDeletionDto) {
    return this.compliance.requestDeletion(req.user.companyId, body.reason, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  @Get('requests')
  listRequests(@Request() req: any) {
    return this.compliance.listRequests(req.user.companyId);
  }
}
