import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

const INVITE_CODE_HEADER = 'x-onboarding-invite-code';

// This guard used to compare the request's code directly against a single
// static ONBOARDING_INVITE_CODE env var — replaced by individual,
// database-backed invitation codes (see InvitationCode / OnboardingService).
// All it does now is fail fast with a clear message when no code was sent
// at all; OnboardingService.createCompany does the real lookup/validation
// (hash comparison, ACTIVE/expired/revoked/used checks) and the atomic
// claim, all inside its own transaction — a guard can't safely do that
// atomically, and re-checking here would still leave a race window.
@Injectable()
export class OnboardingInviteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const headerCode = request.headers?.[INVITE_CODE_HEADER];
    const bodyCode = request.body?.inviteCode;
    const provided = headerCode ?? bodyCode;

    if (typeof provided !== 'string' || !provided.trim()) {
      throw new BadRequestException('El código de invitación es requerido');
    }

    return true;
  }
}
