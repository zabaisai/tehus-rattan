import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompaniesService } from './companies.service';
import { CompanyBrandingService } from './company-branding.service';
import {
  ConfigurationActor,
  TenantConfigurationService,
} from './tenant-configuration.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { UpdateTenantConfigurationDto } from './dto/update-tenant-configuration.dto';
import { UploadCompanyLogoDto } from './dto/upload-company-logo.dto';

const MAX_LOGO_UPLOAD_SIZE = 2 * 1024 * 1024;

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('companies')
export class CompaniesController {
  constructor(
    private companiesService: CompaniesService,
    private companyBrandingService: CompanyBrandingService,
    private tenantConfiguration: TenantConfigurationService,
  ) {}

  /** Quién cambia la configuración, tomado del JWT: nunca del cuerpo. */
  private actorOf(req: any): ConfigurationActor {
    return { userId: req.user.sub, role: req.user.role };
  }

  @Get('me')
  getMyCompany(@Request() req: any) {
    return this.companiesService.findById(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('me')
  updateMyCompany(@Request() req: any, @Body() body: UpdateCompanyDto) {
    return this.companiesService.update(req.user.companyId, body);
  }

  // ── Configuración por empresa (Fase 2) ─────────────────────────────────
  // Contrato agregado `TenantConfigurationV1`: región (columnas), modelo
  // comercial y módulos (settings), categorías y pipeline real. La lee
  // cualquier rol de la empresa porque el frontend la necesita para operar
  // (moneda, zona, categorías); solo la edita un administrador.

  @Get('me/configuration')
  getMyConfiguration(@Request() req: any) {
    return this.tenantConfiguration.get(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('me/configuration')
  updateMyConfiguration(
    @Request() req: any,
    @Body() body: UpdateTenantConfigurationDto,
  ) {
    return this.tenantConfiguration.update(
      req.user.companyId,
      body,
      this.actorOf(req),
    );
  }

  // ── Compatibilidad: vista normalizada de Company.settings (Fase 1) ──────
  // Se conservan para los clientes que ya las usan; delegan en el MISMO motor
  // (transacción, bloqueo, reglas y auditoría), no en una segunda
  // implementación.

  @Get('me/settings')
  getMySettings(@Request() req: any) {
    return this.tenantConfiguration.getLegacySettings(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('me/settings')
  updateMySettings(
    @Request() req: any,
    @Body() body: UpdateCompanySettingsDto,
  ) {
    return this.tenantConfiguration.updateLegacySettings(
      req.user.companyId,
      body,
      this.actorOf(req),
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('me/logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_LOGO_UPLOAD_SIZE } }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadCompanyLogoDto,
    @Request() req: any,
  ) {
    return this.companyBrandingService.uploadLogo(
      req.user.companyId,
      file,
      body.type,
    );
  }
}
