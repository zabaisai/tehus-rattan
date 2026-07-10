import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  imports: [CompaniesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
