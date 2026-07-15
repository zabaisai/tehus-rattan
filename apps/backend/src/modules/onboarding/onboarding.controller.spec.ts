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

  it('parses the raw body via parsePayload and forwards the resolved DTO to createCompany, falling back to the body inviteCode when no header is sent', async () => {
    const dto = { company: { name: 'Tehus Rattan' }, inviteCode: 'TEHUS-FROM-BODY' };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    const rawBody = { data: JSON.stringify(dto) };
    const req = { headers: {} };
    await controller.createCompany(undefined, rawBody, req);

    expect(onboardingService.parsePayload).toHaveBeenCalledWith(rawBody);
    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: undefined, secondaryLogo: undefined },
      'TEHUS-FROM-BODY',
    );
  });

  it('forwards the uploaded logo and secondaryLogo files and the header invite code to createCompany', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    const logoFile = { originalname: 'logo.png' } as Express.Multer.File;
    const secondaryFile = { originalname: 'secondary.png' } as Express.Multer.File;
    const req = { headers: { 'x-onboarding-invite-code': 'TEHUS-FROM-HEADER' } };

    await controller.createCompany(
      { logo: [logoFile], secondaryLogo: [secondaryFile] },
      { data: '{}' },
      req,
    );

    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: logoFile, secondaryLogo: secondaryFile },
      'TEHUS-FROM-HEADER',
    );
  });

  it('prefers the header invite code over the body one when both are present', async () => {
    const dto = { company: { name: 'Tehus Rattan' }, inviteCode: 'TEHUS-FROM-BODY' };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    const req = { headers: { 'x-onboarding-invite-code': 'TEHUS-FROM-HEADER' } };
    await controller.createCompany(undefined, dto, req);

    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: undefined, secondaryLogo: undefined },
      'TEHUS-FROM-HEADER',
    );
  });

  it('still works for a plain JSON body with no files and no invite code at all', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({ message: 'ok' });

    const req = { headers: {} };
    await controller.createCompany(undefined, dto, req);

    expect(onboardingService.parsePayload).toHaveBeenCalledWith(dto);
    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: undefined, secondaryLogo: undefined },
      undefined,
    );
  });
});
