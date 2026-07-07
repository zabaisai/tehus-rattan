import { Module } from '@nestjs/common';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformCompaniesService } from './platform-companies.service';

@Module({
  controllers: [PlatformCompaniesController],
  providers: [PlatformCompaniesService],
})
export class PlatformModule {}
