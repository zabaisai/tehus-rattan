'use client';

/**
 * CAPACIDADES EFECTIVAS DE LA EMPRESA ACTIVA (Fase 4) — única fuente en el
 * navegador.
 *
 * Todo lo que decide «¿esta empresa tiene catálogo / cotizaciones / tareas?»
 * pasa por aquí: navegación, menú «Crear», buscador, dashboard, guards de
 * ruta y formularios. La verdad la tiene el servidor (`TenantConfigurationV1`,
 * `modules` ya efectivos); este módulo solo la lee, la expone tipada y la
 * actualiza con la respuesta canónica después de un PATCH. El backend vuelve
 * a comprobar la capacidad en cada petición: ocultar aquí no es la seguridad,
 * es la experiencia.
 *
 * Mientras no se conoce la configuración, `can()` responde `false`: un
 * módulo prohibido no parpadea en pantalla ni lanza sus consultas.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import {
  TENANT_CONFIGURATION_QUERY_KEY,
  useTenantConfiguration,
  type CapabilityDefinition,
  type CatalogItemType,
  type OptionalModuleKey,
  type TenantConfiguration,
  type TenantModules,
} from './tenant-configuration';

export type TenantCapabilityKey = keyof TenantModules;
export type { OptionalModuleKey, CapabilityDefinition };

export type TenantCapabilitiesStatus =
  /** Hay sesión de empresa y la configuración todavía no llegó. */
  | 'loading'
  /** La configuración no se pudo cargar; `retry` vuelve a intentarlo. */
  | 'error'
  /** Configuración conocida: `can()` responde con certeza. */
  | 'ready'
  /** SUPER_ADMIN de plataforma sin empresa: no hay capacidades de tenant. */
  | 'platform'
  /** Sin sesión de empresa (todavía): nada que resolver. */
  | 'anonymous';

export interface CatalogRules {
  allowedItemTypes: CatalogItemType[];
  defaultItemType: CatalogItemType;
}

export interface TenantCapabilities {
  status: TenantCapabilitiesStatus;
  /** `true` solo con `status === 'ready'`. */
  isReady: boolean;
  configuration: TenantConfiguration | null;
  modules: TenantModules | null;
  /** `false` mientras no haya configuración conocida. */
  can: (key: TenantCapabilityKey) => boolean;
  catalog: CatalogRules | null;
  definitions: CapabilityDefinition[];
  definition: (key: TenantCapabilityKey) => CapabilityDefinition | undefined;
  legacyDefaultsApplied: OptionalModuleKey[];
  error: unknown;
  retry: () => void;
  /** Sustituye la caché por la respuesta canónica del servidor (tras PATCH). */
  apply: (configuration: TenantConfiguration) => void;
}

const FALLBACK_DEFINITIONS: CapabilityDefinition[] = [];

function useBuildTenantCapabilities(active: boolean): TenantCapabilities {
  const user = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();

  const isPlatform = user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const hasTenant = Boolean(user?.companyId);
  const enabled = active && hasTenant && !isPlatform;

  const query = useTenantConfiguration(enabled);

  const status: TenantCapabilitiesStatus = !hasTenant
    ? isPlatform
      ? 'platform'
      : 'anonymous'
    : query.data
      ? 'ready'
      : query.isError
        ? 'error'
        : 'loading';

  const configuration = status === 'ready' ? (query.data ?? null) : null;
  const modules = configuration?.modules ?? null;
  const definitions =
    configuration?.capabilities?.definitions ?? FALLBACK_DEFINITIONS;

  const can = useCallback(
    (key: TenantCapabilityKey) => Boolean(modules && modules[key]),
    [modules],
  );
  const definition = useCallback(
    (key: TenantCapabilityKey) => definitions.find((d) => d.key === key),
    [definitions],
  );
  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);
  const apply = useCallback(
    (next: TenantConfiguration) => {
      queryClient.setQueryData(TENANT_CONFIGURATION_QUERY_KEY, next);
    },
    [queryClient],
  );

  void authStatus;

  return useMemo(
    () => ({
      status,
      isReady: status === 'ready',
      configuration,
      modules,
      can,
      catalog: configuration?.capabilities?.catalog ?? null,
      definitions,
      definition,
      legacyDefaultsApplied:
        configuration?.capabilities?.legacyDefaultsApplied ?? [],
      error: query.error,
      retry,
      apply,
    }),
    [
      status,
      configuration,
      modules,
      can,
      definitions,
      definition,
      query.error,
      retry,
      apply,
    ],
  );
}

const TenantCapabilitiesContext = createContext<TenantCapabilities | null>(
  null,
);

/**
 * Se monta una vez en el shell autenticado. Los componentes de dentro leen el
 * mismo valor: una sola consulta, un solo estado, sin parpadeos distintos por
 * pantalla.
 */
export function TenantCapabilitiesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useBuildTenantCapabilities(true);
  return (
    <TenantCapabilitiesContext.Provider value={value}>
      {children}
    </TenantCapabilitiesContext.Provider>
  );
}

/**
 * Capacidades de la empresa activa. Dentro del proveedor comparte su estado;
 * fuera (pruebas, pantallas aisladas) resuelve por su cuenta con la misma
 * consulta, así que el comportamiento no depende de dónde se renderice.
 */
export function useTenantCapabilities(): TenantCapabilities {
  const fromContext = useContext(TenantCapabilitiesContext);
  const standalone = useBuildTenantCapabilities(fromContext === null);
  return fromContext ?? standalone;
}

// ── Rutas gobernadas ─────────────────────────────────────────────────────

const ROUTE_CAPABILITIES: Array<[prefix: string, key: TenantCapabilityKey]> =
  [
    ['/dashboard/products', 'catalog'],
    ['/dashboard/quotes', 'quotes'],
    ['/dashboard/tasks', 'tasks'],
    ['/dashboard/pipeline', 'pipeline'],
    ['/dashboard/contacts', 'contacts'],
    ['/dashboard/conversations', 'conversations'],
  ];

/** Capacidad que gobierna una ruta del dashboard, si alguna. */
export function capabilityForPath(
  pathname: string,
): TenantCapabilityKey | null {
  for (const [prefix, key] of ROUTE_CAPABILITIES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return key;
  }
  return null;
}

// ── Vocabulario del catálogo según el modelo comercial ───────────────────

export interface CatalogVocabulary {
  /** 'products' | 'services' | 'mixed' según los tipos que puede crear. */
  mode: 'products' | 'services' | 'mixed';
  title: string;
  singular: string;
  plural: string;
  newItem: string;
  editItem: string;
  emptyTitle: string;
  emptyHint: string;
  /** Si hay que mostrar el selector Producto/Servicio y el filtro por tipo. */
  showTypeChooser: boolean;
}

export function catalogVocabulary(
  rules: CatalogRules | null | undefined,
): CatalogVocabulary {
  const allowed = rules?.allowedItemTypes ?? ['PRODUCT', 'SERVICE'];
  const onlyProducts = allowed.length === 1 && allowed[0] === 'PRODUCT';
  const onlyServices = allowed.length === 1 && allowed[0] === 'SERVICE';
  if (onlyProducts) {
    return {
      mode: 'products',
      title: 'Catálogo de productos',
      singular: 'producto',
      plural: 'productos',
      newItem: 'Nuevo producto',
      editItem: 'Editar producto',
      emptyTitle: 'Todavía no hay productos',
      emptyHint:
        'Crea tu primer producto con nombre, precio y categoría para adjuntarlo a las oportunidades.',
      showTypeChooser: false,
    };
  }
  if (onlyServices) {
    return {
      mode: 'services',
      title: 'Catálogo de servicios',
      singular: 'servicio',
      plural: 'servicios',
      newItem: 'Nuevo servicio',
      editItem: 'Editar servicio',
      emptyTitle: 'Todavía no hay servicios',
      emptyHint:
        'Crea tu primer servicio con nombre y precio para proponerlo en las oportunidades. No necesitas inventario.',
      showTypeChooser: false,
    };
  }
  return {
    mode: 'mixed',
    title: 'Catálogo',
    singular: 'elemento',
    plural: 'elementos',
    newItem: 'Nuevo elemento',
    editItem: 'Editar elemento',
    emptyTitle: 'Todavía no hay elementos en el catálogo',
    emptyHint:
      'Crea productos y servicios con nombre y precio para adjuntarlos a las oportunidades.',
    showTypeChooser: true,
  };
}

/** Un elemento heredado es del tipo que la empresa ya no crea. */
export function isLegacyItemType(
  rules: CatalogRules | null | undefined,
  itemType: CatalogItemType,
): boolean {
  if (!rules) return false;
  return !rules.allowedItemTypes.includes(itemType);
}
