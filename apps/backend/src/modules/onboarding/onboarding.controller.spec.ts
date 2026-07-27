import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OnboardingController } from './onboarding.controller';
import { OnboardingInviteGuard } from '../../common/guards/onboarding-invite.guard';

function buildReq(overrides: Record<string, unknown> = {}) {
  return {
    ip: '181.60.12.24',
    deviceId: 'device-1',
    headers: {},
    ...overrides,
  } as any;
}

function buildRes() {
  return { cookie: jest.fn() } as any;
}

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
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- reflection only, never invoked
      controller.createCompany,
    );
    expect(guards).toContain(OnboardingInviteGuard);
  });

  it('parses the raw body via parsePayload and forwards the resolved DTO + request context to createCompany, falling back to the body inviteCode when no header is sent', async () => {
    const dto = {
      company: { name: 'Tehus Rattan' },
      inviteCode: 'TEHUS-FROM-BODY',
    };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({
      message: 'ok',
      token: 't',
      refreshToken: 'plain-refresh-token',
    });

    const rawBody = { data: JSON.stringify(dto) };
    const req = buildReq({ headers: {} });
    const res = buildRes();
    const result = await controller.createCompany(undefined, rawBody, req, res);

    expect(onboardingService.parsePayload).toHaveBeenCalledWith(rawBody);
    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: undefined, secondaryLogo: undefined },
      'TEHUS-FROM-BODY',
      expect.objectContaining({ deviceIdHash: expect.any(String) }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'tehus_refresh_token',
      'plain-refresh-token',
      expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
    );
    expect(result).toEqual({ message: 'ok', token: 't' });
    expect(JSON.stringify(result)).not.toContain('plain-refresh-token');
  });

  it('forwards the uploaded logo and secondaryLogo files and the header invite code to createCompany', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({
      message: 'ok',
      refreshToken: 'rt',
    });

    const logoFile = { originalname: 'logo.png' } as Express.Multer.File;
    const secondaryFile = {
      originalname: 'secondary.png',
    } as Express.Multer.File;
    const req = buildReq({
      headers: { 'x-onboarding-invite-code': 'TEHUS-FROM-HEADER' },
    });

    await controller.createCompany(
      { logo: [logoFile], secondaryLogo: [secondaryFile] },
      { data: '{}' },
      req,
      buildRes(),
    );

    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: logoFile, secondaryLogo: secondaryFile },
      'TEHUS-FROM-HEADER',
      expect.anything(),
    );
  });

  it('prefers the header invite code over the body one when both are present', async () => {
    const dto = {
      company: { name: 'Tehus Rattan' },
      inviteCode: 'TEHUS-FROM-BODY',
    };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({
      message: 'ok',
      refreshToken: 'rt',
    });

    const req = buildReq({
      headers: { 'x-onboarding-invite-code': 'TEHUS-FROM-HEADER' },
    });
    await controller.createCompany(undefined, dto, req, buildRes());

    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: undefined, secondaryLogo: undefined },
      'TEHUS-FROM-HEADER',
      expect.anything(),
    );
  });

  it('still works for a plain JSON body with no files and no invite code at all', async () => {
    const dto = { company: { name: 'Tehus Rattan' } };
    onboardingService.parsePayload.mockResolvedValue(dto);
    onboardingService.createCompany.mockResolvedValue({
      message: 'ok',
      refreshToken: 'rt',
    });

    const req = buildReq({ headers: {} });
    await controller.createCompany(undefined, dto, req, buildRes());

    expect(onboardingService.parsePayload).toHaveBeenCalledWith(dto);
    expect(onboardingService.createCompany).toHaveBeenCalledWith(
      dto,
      { logo: undefined, secondaryLogo: undefined },
      undefined,
      expect.anything(),
    );
  });
});
