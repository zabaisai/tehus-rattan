import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) return false;

    return user.role === 'SUPER_ADMIN' && user.companyId === null;
  }
}
