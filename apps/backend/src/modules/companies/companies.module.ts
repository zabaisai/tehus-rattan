import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyBrandingService } from './company-branding.service';
import { CompaniesController } from './companies.controller';

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyBrandingService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
