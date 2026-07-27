import { BadRequestException } from '@nestjs/common';
import { OnboardingInviteGuard } from './onboarding-invite.guard';

function buildContext(headers: Record<string, string> = {}, body: any = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, body }),
    }),
  } as any;
}

describe('OnboardingInviteGuard', () => {
  let guard: OnboardingInviteGuard;

  beforeEach(() => {
    guard = new OnboardingInviteGuard();
  });

  it('rejects a request with no code at all', () => {
    expect(() => guard.canActivate(buildContext({}, {}))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a request with a blank code in the header', () => {
    expect(() =>
      guard.canActivate(buildContext({ 'x-onboarding-invite-code': '   ' })),
    ).toThrow(BadRequestException);
  });

  it('allows a request with any non-blank code in the header (real validation happens in the service)', () => {
    expect(
      guard.canActivate(
        buildContext({
          'x-onboarding-invite-code': 'TEHUS-AAAA-BBBB-CCCC-DDDD',
        }),
      ),
    ).toBe(true);
  });

  it('allows a request with any non-blank code in the body', () => {
    expect(
      guard.canActivate(
        buildContext({}, { inviteCode: 'TEHUS-AAAA-BBBB-CCCC-DDDD' }),
      ),
    ).toBe(true);
  });

  it('prefers the header over the body when both are present', () => {
    expect(
      guard.canActivate(
        buildContext(
          { 'x-onboarding-invite-code': 'header-code' },
          { inviteCode: '' },
        ),
      ),
    ).toBe(true);
  });
});
