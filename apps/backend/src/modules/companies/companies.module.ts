import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyBrandingService } from './company-branding.service';
import { CompaniesController } from './companies.controller';
import { TenantConfigurationService } from './tenant-configuration.service';
import { TenantCapabilityGuard } from './tenant-capability.guard';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  controllers: [CompaniesController],
  providers: [
    CompaniesService,
    CompanyBrandingService,
    TenantConfigurationService,
    TenantCapabilityGuard,
    PlatformAuditLogService,
  ],
  exports: [
    CompaniesService,
    CompanyBrandingService,
    TenantConfigurationService,
    TenantCapabilityGuard,
  ],
})
export class CompaniesModule {}
