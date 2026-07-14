import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Method-level @Roles overrides class-level @Roles; a controller-only
    // decorator (e.g. AnalyticsController, AutomationsController) must still
    // be enforced even though no individual handler carries its own metadata.
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    return !!user && roles.includes(user.role);
  }
}
