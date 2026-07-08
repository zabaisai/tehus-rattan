import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class BusinessTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || typeof user.companyId !== 'string' || !user.companyId) {
      throw new ForbiddenException(
        'Este endpoint requiere un usuario asociado a una empresa',
      );
    }

    return true;
  }
}
