import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompaniesModule } from '../companies/companies.module';
import { PlatformModule } from '../platform/platform.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { CookieOriginGuard } from '../../common/guards/cookie-origin.guard';

@Module({
  imports: [CompaniesModule, AuthModule, PlatformModule, SessionsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, CookieOriginGuard],
})
export class OnboardingModule {}
