import { SetMetadata } from '@nestjs/common';
import type { TenantCapabilityKey } from '../../modules/companies/tenant-capabilities';

export const TENANT_CAPABILITY_KEY = 'tenantCapability';

/**
 * Declara qué capacidad de la empresa gobierna un controlador o un handler.
 * La hace cumplir `TenantCapabilityGuard`, que lee el `companyId` del token
 * y resuelve la configuración efectiva de esa empresa. Un handler puede
 * sobrescribir la del controlador (por ejemplo, para eximir una lectura).
 */
export const RequiresTenantCapability = (capability: TenantCapabilityKey) =>
  SetMetadata(TENANT_CAPABILITY_KEY, capability);
