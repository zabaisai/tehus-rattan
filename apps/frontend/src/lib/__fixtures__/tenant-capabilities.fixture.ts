import type { TenantCapabilities } from '../tenant-capabilities';
import type {
  CapabilityDefinition,
  OptionalModuleKey,
  TenantConfiguration,
  TenantModules,
} from '../tenant-configuration';

/**
 * Capacidades de empresa para pruebas (Fase 4), con la MISMA forma que publica
 * el backend. Las pantallas que no prueban capacidades montan «todo activo y
 * listo»; las que sí, apagan un módulo o fuerzan `loading`/`error`.
 */
export const DEFINICIONES_DE_PRUEBA: CapabilityDefinition[] = [
  {
    key: 'conversations',
    label: 'Conversaciones',
    description: 'Bandeja de WhatsApp y mensajería con los clientes.',
    group: 'core',
    alwaysOn: true,
    configurable: false,
    dependsOn: [],
    relatedTo: [],
  },
  {
    key: 'contacts',
    label: 'Contactos',
    description: 'Personas y empresas con las que se habla.',
    group: 'core',
    alwaysOn: true,
    configurable: false,
    dependsOn: [],
    relatedTo: [],
  },
  {
    key: 'opportunities',
    label: 'Oportunidades',
    description: 'Ventas en curso, con su valor y su etapa.',
    group: 'core',
    alwaysOn: true,
    configurable: false,
    dependsOn: [],
    relatedTo: [],
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    description: 'Etapas por las que avanza cada oportunidad.',
    group: 'core',
    alwaysOn: true,
    configurable: false,
    dependsOn: [],
    relatedTo: [],
  },
  {
    key: 'catalog',
    label: 'Catálogo',
    description: 'Lista de productos o servicios con precio y categorías.',
    group: 'commercial',
    alwaysOn: false,
    configurable: true,
    dependsOn: [],
    relatedTo: ['quotes'],
  },
  {
    key: 'quotes',
    label: 'Cotizaciones',
    description: 'Documentos de venta a partir de una oportunidad.',
    group: 'commercial',
    alwaysOn: false,
    configurable: true,
    dependsOn: [],
    relatedTo: ['catalog'],
  },
  {
    key: 'tasks',
    label: 'Tareas',
    description: 'Seguimientos y recordatorios del equipo.',
    group: 'commercial',
    alwaysOn: false,
    configurable: true,
    dependsOn: [],
    relatedTo: [],
  },
];

export const MODULOS_TODOS_ACTIVOS: TenantModules = {
  conversations: true,
  contacts: true,
  opportunities: true,
  pipeline: true,
  catalog: true,
  quotes: true,
  tasks: true,
};

type ReglasDeCatalogo = TenantConfiguration['capabilities']['catalog'];

export function configuracionDePrueba(
  over: {
    modules?: Partial<TenantModules>;
    legacyDefaultsApplied?: OptionalModuleKey[];
    categories?: string[];
    identity?: Partial<TenantConfiguration['identity']>;
    catalogRules?: ReglasDeCatalogo;
    definitions?: CapabilityDefinition[];
  } = {},
): TenantConfiguration {
  const modules: TenantModules = { ...MODULOS_TODOS_ACTIVOS, ...over.modules };
  return {
    contractVersion: 1,
    storageVersion: 2,
    identity: {
      industry: null,
      businessType: null,
      businessModel: 'products',
      templateVersion: null,
      ...over.identity,
    },
    regional: {
      country: 'Colombia',
      timezone: 'America/Bogota',
      currency: 'COP',
      locale: 'es-CO',
    },
    modules,
    capabilities: {
      legacyDefaultsApplied: over.legacyDefaultsApplied ?? [],
      catalog: over.catalogRules ?? {
        allowedItemTypes: ['PRODUCT'],
        defaultItemType: 'PRODUCT',
      },
      definitions: over.definitions ?? DEFINICIONES_DE_PRUEBA,
    },
    catalog: { categories: over.categories ?? [], allowFreeText: true },
    pipeline: null,
    limits: {
      categories: { maxLength: 60, maxCount: 30 },
      regional: {
        country: { maxLength: 80 },
        timezone: { maxLength: 64 },
        currency: { length: 3 },
        locale: { maxLength: 35 },
      },
    },
  };
}

/**
 * Un `TenantCapabilities` completo. Por defecto: `ready` con todo activo.
 * `status: 'loading' | 'error' | 'platform'` deja `configuration` en `null`
 * y `can()` en falso, igual que el hook real.
 */
export function capacidadesDePrueba(
  over: {
    status?: TenantCapabilities['status'];
    modules?: Partial<TenantModules>;
    legacyDefaultsApplied?: OptionalModuleKey[];
    categories?: string[];
    catalogRules?: ReglasDeCatalogo;
    error?: unknown;
    retry?: () => void;
    apply?: (c: TenantConfiguration) => void;
  } = {},
): TenantCapabilities {
  const status = over.status ?? 'ready';
  const configuration =
    status === 'ready'
      ? configuracionDePrueba({
          modules: over.modules,
          legacyDefaultsApplied: over.legacyDefaultsApplied,
          categories: over.categories,
          catalogRules: over.catalogRules,
        })
      : null;
  const modules = configuration?.modules ?? null;
  const definitions = configuration?.capabilities.definitions ?? [];
  return {
    status,
    isReady: status === 'ready',
    configuration,
    modules,
    can: (key) => Boolean(modules && modules[key]),
    catalog: configuration?.capabilities.catalog ?? null,
    definitions,
    definition: (key) => definitions.find((d) => d.key === key),
    legacyDefaultsApplied: configuration?.capabilities.legacyDefaultsApplied ?? [],
    error: over.error ?? (status === 'error' ? new Error('boom') : undefined),
    retry: over.retry ?? (() => {}),
    apply: over.apply ?? (() => {}),
  };
}
