import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompaniesModule } from '../companies/companies.module';
import { PlatformModule } from '../platform/platform.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingTemplatesController } from './onboarding-templates.controller';

@Module({
  imports: [CompaniesModule, AuthModule, PlatformModule, SessionsModule],
  controllers: [OnboardingController, OnboardingTemplatesController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
