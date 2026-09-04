/**
 * REGISTRO CANÓNICO DE CAPACIDADES POR EMPRESA (Fase 4).
 *
 * Una capacidad es algo que el CRM puede hacer para una empresa: un módulo
 * siempre presente (contactos, oportunidades, pipeline, conversaciones) o uno
 * opcional que la configuración activa o desactiva (catálogo, cotizaciones,
 * tareas). Aquí vive la ÚNICA descripción de cada una —qué bandera la gobierna,
 * qué rutas, endpoints, entradas de navegación, acciones rápidas y widgets le
 * pertenecen, de qué depende y cómo se comporta una empresa anterior a la
 * configuración—, y la ÚNICA función que decide si está activa:
 * `resolveEffectiveCapabilities`.
 *
 * Regla de compatibilidad: lo que una empresa nunca declaró se resuelve con
 * `legacyDefault` (activo), no con el `false` de `DEFAULT_COMMERCIAL`. Una
 * empresa sin settings, o con settings antiguos sin la bandera, sigue viendo
 * y usando sus productos, cotizaciones y tareas exactamente como antes de esta
 * fase. Solo una decisión explícita (bandera guardada en `false`) desactiva.
 *
 * Desactivar nunca borra: los datos siguen en su tabla y vuelven a aparecer al
 * reactivar. Nada de este archivo escribe en la base.
 */
import { ForbiddenException } from '@nestjs/common';
import type { BusinessModel } from '../onboarding/templates/onboarding-templates';
import type {
  CommercialFlags,
  NormalizedCompanySettings,
} from './company-settings';

export type CoreCapabilityKey =
  | 'conversations'
  | 'contacts'
  | 'opportunities'
  | 'pipeline';

export type OptionalCapabilityKey = 'catalog' | 'quotes' | 'tasks';

export type TenantCapabilityKey = CoreCapabilityKey | OptionalCapabilityKey;

export const OPTIONAL_CAPABILITIES: readonly OptionalCapabilityKey[] = [
  'catalog',
  'quotes',
  'tasks',
] as const;

export const CORE_CAPABILITIES: readonly CoreCapabilityKey[] = [
  'conversations',
  'contacts',
  'opportunities',
  'pipeline',
] as const;

export type CatalogItemTypeName = 'PRODUCT' | 'SERVICE';

/** Roles que pueden activar o desactivar una capacidad configurable. */
export const CAPABILITY_CONFIGURABLE_BY = ['ADMIN', 'SUPER_ADMIN'] as const;

export interface CapabilityDefinition {
  key: TenantCapabilityKey;
  /** Etiqueta que ve la persona; vocabulario base del producto. */
  label: string;
  description: string;
  group: 'core' | 'commercial';
  /** Siempre disponible: no depende de la configuración. */
  alwaysOn: boolean;
  /** Un ADMIN puede activarla o desactivarla desde Configuración. */
  configurable: boolean;
  /** Bandera de `Company.settings` que la gobierna (`null` si es fija). */
  settingsFlag: keyof CommercialFlags | null;
  /** Capacidades que DEBEN estar activas para activar esta (dependencia dura). */
  dependsOn: OptionalCapabilityKey[];
  /**
   * Capacidades que esta usa en algún flujo sin exigirlas (dependencia de
   * creación): las plantillas activan cotizaciones sin catálogo a propósito.
   */
  relatedTo: OptionalCapabilityKey[];
  /** Valor efectivo cuando la empresa nunca declaró la bandera. */
  legacyDefault: boolean;
  /** Rutas del frontend gobernadas (prefijos). */
  frontendRoutes: string[];
  /** Operaciones de la API gobernadas (prefijos de ruta). */
  apiOperations: string[];
  /** Entradas de navegación, acciones rápidas, widgets y tipos de búsqueda. */
  navItems: string[];
  quickActions: string[];
  widgets: string[];
  searchTypes: string[];
}

const core = (
  key: CoreCapabilityKey,
  label: string,
  description: string,
  extras: Partial<
    Pick<
      CapabilityDefinition,
      | 'frontendRoutes'
      | 'apiOperations'
      | 'navItems'
      | 'quickActions'
      | 'widgets'
      | 'searchTypes'
    >
  >,
): CapabilityDefinition => ({
  key,
  label,
  description,
  group: 'core',
  alwaysOn: true,
  configurable: false,
  settingsFlag: null,
  dependsOn: [],
  relatedTo: [],
  legacyDefault: true,
  frontendRoutes: [],
  apiOperations: [],
  navItems: [],
  quickActions: [],
  widgets: [],
  searchTypes: [],
  ...extras,
});

export const CAPABILITY_REGISTRY: Record<
  TenantCapabilityKey,
  CapabilityDefinition
> = {
  conversations: core(
    'conversations',
    'Conversaciones',
    'Bandeja de WhatsApp y mensajes con los contactos.',
    {
      frontendRoutes: ['/dashboard/conversations'],
      apiOperations: ['/conversations', '/messages'],
      navItems: ['conversations'],
      searchTypes: ['conversaciones'],
    },
  ),
  contacts: core(
    'contacts',
    'Contactos',
    'Personas y empresas con las que se habla.',
    {
      frontendRoutes: ['/dashboard/contacts'],
      apiOperations: ['/contacts'],
      navItems: ['contacts'],
      quickActions: ['contacto'],
      searchTypes: ['contactos'],
    },
  ),
  opportunities: core(
    'opportunities',
    'Oportunidades',
    'Leads que avanzan por el pipeline.',
    {
      apiOperations: ['/leads'],
      quickActions: ['oportunidad'],
      searchTypes: ['oportunidades'],
    },
  ),
  pipeline: core('pipeline', 'Pipeline', 'Tablero de etapas de la empresa.', {
    frontendRoutes: ['/dashboard/pipeline'],
    apiOperations: ['/pipelines'],
    navItems: ['pipeline'],
    widgets: ['embudo-comercial', 'metricas-pipeline'],
  }),
  catalog: {
    key: 'catalog',
    label: 'Catálogo',
    description:
      'Productos y servicios con precio que se adjuntan a las oportunidades. Desactivarlo oculta el catálogo sin borrar ningún elemento.',
    group: 'commercial',
    alwaysOn: false,
    configurable: true,
    settingsFlag: 'usesCatalog',
    dependsOn: [],
    relatedTo: [],
    legacyDefault: true,
    frontendRoutes: ['/dashboard/products'],
    apiOperations: ['/products', '/leads/:leadId/products'],
    navItems: ['products'],
    quickActions: ['producto'],
    widgets: [],
    searchTypes: ['productos'],
  },
  quotes: {
    key: 'quotes',
    label: 'Cotizaciones',
    description:
      'Propuestas con precio a partir de una oportunidad. Crear una nueva necesita elementos del catálogo en la oportunidad; las existentes se consultan siempre.',
    group: 'commercial',
    alwaysOn: false,
    configurable: true,
    settingsFlag: 'usesQuotes',
    dependsOn: [],
    relatedTo: ['catalog'],
    legacyDefault: true,
    frontendRoutes: ['/dashboard/quotes'],
    apiOperations: ['/quotes'],
    navItems: ['quotes'],
    quickActions: ['cotizacion'],
    widgets: [],
    searchTypes: ['cotizaciones'],
  },
  tasks: {
    key: 'tasks',
    label: 'Tareas',
    description:
      'Seguimientos con fecha para el equipo. Desactivarlas oculta la agenda sin borrar ninguna tarea.',
    group: 'commercial',
    alwaysOn: false,
    configurable: true,
    settingsFlag: 'usesTasks',
    dependsOn: [],
    relatedTo: [],
    legacyDefault: true,
    frontendRoutes: ['/dashboard/tasks'],
    apiOperations: ['/tasks', '/task-suggestions'],
    navItems: ['tasks'],
    quickActions: ['tarea'],
    widgets: ['agenda-de-hoy', 'metrica-tareas'],
    searchTypes: [],
  },
};

export const CAPABILITY_KEYS = Object.keys(
  CAPABILITY_REGISTRY,
) as TenantCapabilityKey[];

export function isTenantCapabilityKey(
  value: unknown,
): value is TenantCapabilityKey {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, value)
  );
}

/** Vista pública y estable de una definición (lo que viaja al frontend). */
export interface CapabilityDefinitionView {
  key: TenantCapabilityKey;
  label: string;
  description: string;
  group: 'core' | 'commercial';
  alwaysOn: boolean;
  configurable: boolean;
  dependsOn: OptionalCapabilityKey[];
  relatedTo: OptionalCapabilityKey[];
}

export function capabilityDefinitions(): CapabilityDefinitionView[] {
  return CAPABILITY_KEYS.map((key) => {
    const d = CAPABILITY_REGISTRY[key];
    return {
      key: d.key,
      label: d.label,
      description: d.description,
      group: d.group,
      alwaysOn: d.alwaysOn,
      configurable: d.configurable,
      dependsOn: [...d.dependsOn],
      relatedTo: [...d.relatedTo],
    };
  });
}

// ── Resolución efectiva ──────────────────────────────────────────────────

export interface EffectiveModules {
  conversations: true;
  contacts: true;
  opportunities: true;
  pipeline: true;
  catalog: boolean;
  quotes: boolean;
  tasks: boolean;
}

export interface TenantCapabilities {
  modules: EffectiveModules;
  /** Opcionales que quedaron activos por compatibilidad (nunca se declararon). */
  legacyDefaultsApplied: OptionalCapabilityKey[];
  catalog: {
    /** Tipos que la empresa puede CREAR; las filas heredadas se leen siempre. */
    allowedItemTypes: CatalogItemTypeName[];
    /** Tipo cuando un cliente omite `itemType`. */
    defaultItemType: CatalogItemTypeName;
  };
  definitions: CapabilityDefinitionView[];
}

/**
 * Banderas comerciales EFECTIVAS: las declaradas tal cual; las no declaradas
 * con el default de compatibilidad de su capacidad (módulos → activos) o
 * `false` para `sellsProducts`/`sellsServices`, que no gobiernan módulos y
 * sin declaración significan «modelo desconocido», no «vende ambos».
 *
 * Es la base sobre la que el motor fusiona un PATCH: fusionar sobre el
 * `false` por defecto apagaba en silencio los demás módulos de una empresa
 * legacy que solo quería desactivar uno.
 */
export function resolveEffectiveCommercial(
  settings: Pick<NormalizedCompanySettings, 'declaredFlags'>,
): CommercialFlags {
  const declared = settings.declaredFlags;
  return {
    sellsProducts: declared.sellsProducts ?? false,
    sellsServices: declared.sellsServices ?? false,
    usesCatalog:
      declared.usesCatalog ?? CAPABILITY_REGISTRY.catalog.legacyDefault,
    usesQuotes: declared.usesQuotes ?? CAPABILITY_REGISTRY.quotes.legacyDefault,
    usesTasks: declared.usesTasks ?? CAPABILITY_REGISTRY.tasks.legacyDefault,
  };
}

export function allowedItemTypesFor(
  model: BusinessModel | null,
): CatalogItemTypeName[] {
  if (model === 'products') return ['PRODUCT'];
  if (model === 'services') return ['SERVICE'];
  return ['PRODUCT', 'SERVICE'];
}

export function defaultItemTypeFor(
  model: BusinessModel | null,
): CatalogItemTypeName {
  return model === 'services' ? 'SERVICE' : 'PRODUCT';
}

function modelFrom(flags: CommercialFlags): BusinessModel | null {
  if (flags.sellsProducts && flags.sellsServices) return 'mixed';
  if (flags.sellsProducts) return 'products';
  if (flags.sellsServices) return 'services';
  return null;
}

export function resolveEffectiveCapabilities(
  settings: Pick<NormalizedCompanySettings, 'declaredFlags'>,
): TenantCapabilities {
  const flags = resolveEffectiveCommercial(settings);
  const legacyDefaultsApplied: OptionalCapabilityKey[] = [];
  for (const key of OPTIONAL_CAPABILITIES) {
    const flag = CAPABILITY_REGISTRY[key].settingsFlag;
    if (flag && settings.declaredFlags[flag] === undefined) {
      legacyDefaultsApplied.push(key);
    }
  }
  const model = modelFrom(flags);
  return {
    modules: {
      conversations: true,
      contacts: true,
      opportunities: true,
      pipeline: true,
      catalog: flags.usesCatalog,
      quotes: flags.usesQuotes,
      tasks: flags.usesTasks,
    },
    legacyDefaultsApplied,
    catalog: {
      allowedItemTypes: allowedItemTypesFor(model),
      defaultItemType: defaultItemTypeFor(model),
    },
    definitions: capabilityDefinitions(),
  };
}

/**
 * Comprueba las dependencias duras de un conjunto de módulos ya fusionado.
 * Devuelve el primer motivo en español, o `null` si todo es coherente. Hoy no
 * hay dependencias duras (ver `relatedTo` de cotizaciones), pero el punto de
 * control existe para que añadir una sea cambiar el registro, no el motor.
 */
export function moduleDependencyViolation(modules: {
  catalog: boolean;
  quotes: boolean;
  tasks: boolean;
}): string | null {
  for (const key of OPTIONAL_CAPABILITIES) {
    if (!modules[key]) continue;
    for (const dep of CAPABILITY_REGISTRY[key].dependsOn) {
      if (!modules[dep]) {
        return `${CAPABILITY_REGISTRY[key].label} requiere ${CAPABILITY_REGISTRY[dep].label}: actívalo primero`;
      }
    }
  }
  return null;
}

// ── Error estable ────────────────────────────────────────────────────────

export const MODULE_DISABLED_CODE = 'MODULE_DISABLED';

/**
 * 403 con código estable. No es un problema de rol (el ADMIN también lo
 * recibe) ni de tenant: el módulo no está activo para ESTA empresa. El cuerpo
 * lleva `module` para que la interfaz ofrezca el enlace correcto a
 * Configuración, y nunca datos de la empresa.
 */
export class ModuleDisabledException extends ForbiddenException {
  constructor(module: TenantCapabilityKey) {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: MODULE_DISABLED_CODE,
      module,
      message: `El módulo ${CAPABILITY_REGISTRY[module].label} no está activo para tu empresa`,
    });
  }
}

/** Mensaje de la validación del tipo de elemento según el modelo comercial. */
export function itemTypeNotAllowedMessage(
  type: CatalogItemTypeName,
  allowed: CatalogItemTypeName[],
): string {
  if (allowed.length === 1 && allowed[0] === 'SERVICE') {
    return 'Esta empresa vende solo servicios: el catálogo no admite productos. Cambia la forma de vender en Configuración si necesitas ambos.';
  }
  if (allowed.length === 1 && allowed[0] === 'PRODUCT') {
    return 'Esta empresa vende solo productos: el catálogo no admite servicios. Cambia la forma de vender en Configuración si necesitas ambos.';
  }
  return `itemType ${type} no permitido`;
}
