import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyBrandingService } from './company-branding.service';
import { CompaniesController } from './companies.controller';
import { TenantConfigurationService } from './tenant-configuration.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [CompaniesController],
  providers: [
    CompaniesService,
    CompanyBrandingService,
    TenantConfigurationService,
    PlatformAuditLogService,
  ],
  exports: [
    CompaniesService,
    CompanyBrandingService,
    TenantConfigurationService,
  ],
})
export class CompaniesModule {}
