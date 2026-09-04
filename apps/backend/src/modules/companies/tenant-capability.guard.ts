import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANT_CAPABILITY_KEY } from '../../common/decorators/requires-tenant-capability.decorator';
import {
  isTenantCapabilityKey,
  ModuleDisabledException,
} from './tenant-capabilities';
import { TenantConfigurationService } from './tenant-configuration.service';

/**
 * Guard de módulo empresarial.
 *
 * Va DESPUÉS de `AuthGuard('jwt')` y `BusinessTenantGuard`: el `companyId`
 * sale exclusivamente de `req.user` (token + sesión validada), nunca del
 * cuerpo, la query ni los headers. La configuración se resuelve con el motor
 * único (`TenantConfigurationService.resolveCapabilities`, con caché corta
 * por empresa) y, si el módulo no está activo, responde 403 con
 * `code: MODULE_DISABLED` y `module`, sin revelar nada más.
 *
 * Sin metadato `@RequiresTenantCapability` el guard no opina: así puede ir
 * a nivel de controlador y eximir una ruta concreta si hiciera falta.
 */
@Injectable()
export class TenantCapabilityGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private configuration: TenantConfigurationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<unknown>(
      TENANT_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required === null) return true;
    if (!isTenantCapabilityKey(required)) {
      // Un decorador mal escrito no puede abrir la puerta.
      throw new ForbiddenException('Capacidad requerida desconocida');
    }

    const req = context.switchToHttp().getRequest();
    const companyId: unknown = req.user?.companyId;
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new ForbiddenException(
        'Este endpoint requiere un usuario asociado a una empresa',
      );
    }

    const capabilities =
      await this.configuration.resolveCapabilities(companyId);
    if (!capabilities.modules[required]) {
      throw new ModuleDisabledException(required);
    }
    return true;
  }
}
