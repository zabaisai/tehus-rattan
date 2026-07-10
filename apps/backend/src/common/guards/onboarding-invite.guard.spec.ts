import { ForbiddenException } from '@nestjs/common';
import { OnboardingInviteGuard } from './onboarding-invite.guard';

function buildContext(headers: Record<string, string> = {}, body: any = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, body }),
    }),
  } as any;
}

describe('OnboardingInviteGuard', () => {
  const originalEnv = process.env.ONBOARDING_INVITE_CODE;
  let guard: OnboardingInviteGuard;

  beforeEach(() => {
    guard = new OnboardingInviteGuard();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ONBOARDING_INVITE_CODE;
    } else {
      process.env.ONBOARDING_INVITE_CODE = originalEnv;
    }
  });

  it('fails closed with 403 when ONBOARDING_INVITE_CODE is not configured', () => {
    delete process.env.ONBOARDING_INVITE_CODE;

    expect(() =>
      guard.canActivate(buildContext({ 'x-onboarding-invite-code': 'anything' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request with no code at all', () => {
    process.env.ONBOARDING_INVITE_CODE = 'secret-code';

    expect(() => guard.canActivate(buildContext({}, {}))).toThrow(ForbiddenException);
  });

  it('rejects a request with an incorrect code in the header', () => {
    process.env.ONBOARDING_INVITE_CODE = 'secret-code';

    expect(() =>
      guard.canActivate(buildContext({ 'x-onboarding-invite-code': 'wrong-code' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request with an incorrect code in the body', () => {
    process.env.ONBOARDING_INVITE_CODE = 'secret-code';

    expect(() =>
      guard.canActivate(buildContext({}, { inviteCode: 'wrong-code' })),
    ).toThrow(ForbiddenException);
  });

  it('allows a request with the correct code in the header', () => {
    process.env.ONBOARDING_INVITE_CODE = 'secret-code';

    expect(
      guard.canActivate(buildContext({ 'x-onboarding-invite-code': 'secret-code' })),
    ).toBe(true);
  });

  it('allows a request with the correct code in the body', () => {
    process.env.ONBOARDING_INVITE_CODE = 'secret-code';

    expect(
      guard.canActivate(buildContext({}, { inviteCode: 'secret-code' })),
    ).toBe(true);
  });

  it('prefers the header over the body when both are present', () => {
    process.env.ONBOARDING_INVITE_CODE = 'secret-code';

    expect(
      guard.canActivate(
        buildContext(
          { 'x-onboarding-invite-code': 'secret-code' },
          { inviteCode: 'wrong-code' },
        ),
      ),
    ).toBe(true);
  });
});
