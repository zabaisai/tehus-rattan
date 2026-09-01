import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Guard GLOBAL de autenticación (deny-by-default).
 *
 * Se registra como APP_GUARD, así que aplica a TODA ruta HTTP salvo las marcadas
 * con `@Public()`. Esto invierte el modelo anterior (auth opt-in por
 * controlador): ahora un controlador nuevo nace PROTEGIDO, y olvidar el guard ya
 * no lo deja abierto por accidente.
 *
 * Los guards por controlador que ya existen (AuthGuard('jwt'), BusinessTenantGuard,
 * RolesGuard, PlatformGuard) se mantienen: este guard es la red de seguridad, no
 * los reemplaza. Se ejecuta ANTES que los guards de controlador, de modo que
 * `req.user` queda disponible para los de tenant/rol.
 */
@Injectable()
export class GlobalJwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Solo aplica a peticiones HTTP; otros transportes (WebSocket) tienen su
    // propia autenticación (RealtimeAuthService) y no pasan por aquí.
    if (context.getType() !== 'http') return true;

    return super.canActivate(context);
  }
}
