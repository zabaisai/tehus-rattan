import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OnboardingController } from './onboarding.controller';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';

describe('OnboardingController', () => {
  let onboardingService: any;
  let controller: OnboardingController;

  beforeEach(() => {
    onboardingService = {
      parsePayload: jest.fn(),
      createCompany: jest.fn(),
    };
    controller = new OnboardingController(onboardingService);
  });

  it('applies OnboardingInviteGuard to POST /onboarding/company', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.createCompany);
    expect(guards).toContain(OnboardingInviteGuard);
  });

  it('parses the raw body via parsePayload and forwards the resolved DTO to createCompany', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    const rawBody = { data: JSON.stringify(dto) };
    await controller.createCompany(undefined, rawBody);

    expect(onboardingService.parsePayload).toHaveBeenCalledWith(rawBody);
    expect(onboardingService.createCompany).toHaveBeenCalledWith(dto, {
      logo: undefined,
      secondaryLogo: undefined,
    });
  });

  it('forwards the uploaded logo and secondaryLogo files to createCompany', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    const logoFile = { originalname: 'logo.png' } as Express.Multer.File;
    const secondaryFile = { originalname: 'secondary.png' } as Express.Multer.File;

    await controller.createCompany(
      { logo: [logoFile], secondaryLogo: [secondaryFile] },
      { data: '{}' },
    );

    expect(onboardingService.createCompany).toHaveBeenCalledWith(dto, {
      logo: logoFile,
      secondaryLogo: secondaryFile,
    });
  });

  it('still works for a plain JSON body with no files at all', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    await controller.createCompany(undefined, dto);

    expect(onboardingService.parsePayload).toHaveBeenCalledWith(dto);
    expect(onboardingService.createCompany).toHaveBeenCalledWith(dto, {
      logo: undefined,
      secondaryLogo: undefined,
    });
  });
});
