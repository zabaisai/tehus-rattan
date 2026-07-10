import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';
import { OnboardingService } from './onboarding.service';
import { CreateOnboardingCompanyDto } from './dto/create-onboarding-company.dto';

@Controller('onboarding')
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  @UseGuards(OnboardingInviteGuard)
  @Post('company')
  createCompany(@Body() body: CreateOnboardingCompanyDto) {
    return this.onboardingService.createCompany(body);
  }
}
