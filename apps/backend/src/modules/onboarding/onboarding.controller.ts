import {
  Body,
  Controller,
  Post,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';
import { OnboardingService } from './onboarding.service';

const MAX_LOGO_UPLOAD_SIZE = 2 * 1024 * 1024;

interface OnboardingUploadedFiles {
  logo?: Express.Multer.File[];
  secondaryLogo?: Express.Multer.File[];
}

@Controller('onboarding')
export class OnboardingController {
  constructor(private onboardingService: OnboardingService) {}

  // Accepts either application/json (existing behavior, no files) or
  // multipart/form-data with the JSON payload in a "data" field plus
  // "logo"/"secondaryLogo" file fields — see OnboardingService.parsePayload.
  //
  // For multipart requests, the invite code MUST be sent via the
  // X-Onboarding-Invite-Code header, not in the body: guards run before
  // interceptors in Nest's request lifecycle, so OnboardingInviteGuard
  // executes before FileFieldsInterceptor/multer has parsed the multipart
  // body — body.inviteCode (and any "data" field content) isn't available
  // yet at that point for a multipart request.
  @UseGuards(OnboardingInviteGuard)
  @Post('company')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'logo', maxCount: 1 },
        { name: 'secondaryLogo', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_LOGO_UPLOAD_SIZE } },
    ),
  )
  async createCompany(
    @UploadedFiles() files: OnboardingUploadedFiles | undefined,
    @Body() body: unknown,
    @Request() req: any,
  ) {
    const dto = await this.onboardingService.parsePayload(body);
    const inviteCode = req.headers?.['x-onboarding-invite-code'] ?? dto.inviteCode;
    return this.onboardingService.createCompany(
      dto,
      {
        logo: files?.logo?.[0],
        secondaryLogo: files?.secondaryLogo?.[0],
      },
      inviteCode,
    );
  }
}
