import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from './tenant-context.storage';

/**
 * Fija el contexto de empresa (AsyncLocalStorage) desde `req.user.companyId` en
 * cada request HTTP autenticada, para toda la duración del handler.
 *
 * Punto de integración de RLS a nivel de aplicación: con RLS activo, cualquier
 * consulta de un servicio que use `runWithTenant` verá el `app.company_id`
 * correcto. Un SUPER_ADMIN de plataforma (companyId null) NO obtiene contexto de
 * empresa: sus accesos cross-company van por el flujo de soporte, explícito y
 * auditado. Es un no-op cuando no hay usuario (rutas públicas).
 *
 * Se registra como APP_INTERCEPTOR. Hoy no cambia el comportamiento (nada exige
 * el contexto hasta activar RLS con el rol separado); deja el contexto listo.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{
      user?: { companyId?: string | null };
    }>();
    const companyId = req?.user?.companyId ?? null;
    if (!companyId) return next.handle();

    // Envuelve TODA la ejecución del handler en el contexto de empresa.
    return TenantContext.ejecutarCon(companyId, () => next.handle());
  }
}
