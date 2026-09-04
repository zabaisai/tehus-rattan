import type { TenantCapabilities } from '../tenant-capabilities';
import type {
  CatalogItemType,
  TenantConfiguration,
  TenantModules,
} from '../tenant-configuration';
import { capacidadesDePrueba } from './tenant-capabilities.fixture';

/**
 * Capacidades de prueba con el MODELO COMERCIAL a la vista: qué tipos puede
 * crear el catálogo de la empresa y de qué sector es. Se apoya en
 * `capacidadesDePrueba` (todo activo y listo) y solo cambia lo que las
 * pantallas del catálogo, las oportunidades y las cotizaciones leen.
 */
export function capacidadesDeCatalogo(
  allowedItemTypes: CatalogItemType[],
  over: {
    modules?: Partial<TenantModules>;
    identity?: Partial<TenantConfiguration['identity']>;
  } = {},
): TenantCapabilities {
  const base = capacidadesDePrueba({ modules: over.modules });
  const catalog = {
    allowedItemTypes,
    defaultItemType: (allowedItemTypes.includes('PRODUCT')
      ? 'PRODUCT'
      : 'SERVICE') as CatalogItemType,
  };
  const businessModel =
    allowedItemTypes.length === 2
      ? 'mixed'
      : allowedItemTypes[0] === 'SERVICE'
        ? 'services'
        : 'products';
  const configuration: TenantConfiguration | null = base.configuration && {
    ...base.configuration,
    identity: {
      ...base.configuration.identity,
      businessModel,
      ...over.identity,
    },
    capabilities: { ...base.configuration.capabilities, catalog },
  };
  return { ...base, configuration, catalog };
}
