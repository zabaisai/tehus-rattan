import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

const INVITE_CODE_HEADER = 'x-onboarding-invite-code';

@Injectable()
export class OnboardingInviteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ONBOARDING_INVITE_CODE;
    if (!expected) {
      throw new ForbiddenException('El registro de empresas no está disponible');
    }

    const request = context.switchToHttp().getRequest();
    const headerCode = request.headers?.[INVITE_CODE_HEADER];
    const bodyCode = request.body?.inviteCode;
    const provided = headerCode ?? bodyCode;

    if (typeof provided !== 'string' || provided !== expected) {
      throw new ForbiddenException('Código de invitación inválido');
    }

    return true;
  }
}
