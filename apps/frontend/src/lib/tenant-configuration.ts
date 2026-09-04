import { useQuery } from '@tanstack/react-query';
import api from './axios';
import type { BusinessModel } from './onboarding-templates';

/**
 * `TenantConfigurationV1` visto desde el navegador (Fase 2).
 *
 * Es el contrato AGREGADO que compone el backend a partir de las columnas de
 * la empresa (región), `Company.settings` (modelo, módulos, categorías) y el
 * pipeline real. Está versionado aparte de cómo se guarda `settings`
 * (`storageVersion`). El esquema publicado vive en
 * `docs/contracts/tenant-configuration.v1.schema.json`; aquí no se interpreta
 * ningún JSON crudo. Los límites llegan en la respuesta para que el aviso
 * previo del formulario y la validación del servidor sean el mismo número.
 */

export type CatalogItemType = 'PRODUCT' | 'SERVICE';

export interface TenantIdentity {
  industry: string | null;
  businessType: string | null;
  businessModel: BusinessModel | null;
  templateVersion: number | null;
}

export interface TenantRegional {
  country: string | null;
  timezone: string;
  currency: string;
  locale: string;
}

export interface TenantModules {
  conversations: true;
  contacts: true;
  opportunities: true;
  pipeline: true;
  catalog: boolean;
  quotes: boolean;
  tasks: boolean;
}

export interface TenantPipelineStage {
  id: string;
  name: string;
  type: 'OPEN' | 'WON' | 'LOST';
  isInitial: boolean;
  order: number;
}

export interface TenantPipeline {
  id: string;
  name: string;
  stages: TenantPipelineStage[];
}

export interface RegionalLimits {
  country: { maxLength: number };
  timezone: { maxLength: number };
  currency: { length: number };
  locale: { maxLength: number };
}

export interface TenantConfiguration {
  contractVersion: 1;
  storageVersion: 0 | 1 | 2;
  identity: TenantIdentity;
  regional: TenantRegional;
  modules: TenantModules;
  catalog: { categories: string[]; allowFreeText: true };
  pipeline: TenantPipeline | null;
  limits: {
    categories: { maxLength: number; maxCount: number };
    regional: RegionalLimits;
  };
}

/** Solo lo editable. Todo lo demás lo rechaza el servidor con 400. */
export interface UpdateTenantConfigurationPayload {
  regional?: Partial<{
    country: string | null;
    timezone: string;
    currency: string;
    locale: string;
  }>;
  commercial?: Partial<{ sellsProducts: boolean; sellsServices: boolean }>;
  modules?: Partial<{ catalog: boolean; quotes: boolean; tasks: boolean }>;
  catalog?: { categories: string[] };
}

export const TENANT_CONFIGURATION_QUERY_KEY = [
  'company-me',
  'configuration',
] as const;

/** Mismos valores que `REGIONAL_LIMITS` del backend; el servidor manda. */
export const DEFAULT_REGIONAL_LIMITS: RegionalLimits = {
  country: { maxLength: 80 },
  timezone: { maxLength: 64 },
  currency: { length: 3 },
  locale: { maxLength: 35 },
};

export async function getMyTenantConfiguration(): Promise<TenantConfiguration> {
  const { data } = await api.get<TenantConfiguration>(
    '/companies/me/configuration',
  );
  return data;
}

export async function updateMyTenantConfiguration(
  payload: UpdateTenantConfigurationPayload,
): Promise<TenantConfiguration> {
  const { data } = await api.patch<TenantConfiguration>(
    '/companies/me/configuration',
    payload,
  );
  return data;
}

export function useTenantConfiguration(enabled = true) {
  return useQuery({
    queryKey: TENANT_CONFIGURATION_QUERY_KEY,
    queryFn: getMyTenantConfiguration,
    enabled,
  });
}

// ── Etiquetas ────────────────────────────────────────────────────────────

export const ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
};

export const ITEM_TYPE_PLURAL_LABELS: Record<CatalogItemType, string> = {
  PRODUCT: 'Productos',
  SERVICE: 'Servicios',
};

export const CORE_MODULE_LABELS: Record<
  'conversations' | 'contacts' | 'opportunities' | 'pipeline',
  string
> = {
  conversations: 'Conversaciones',
  contacts: 'Contactos',
  opportunities: 'Oportunidades',
  pipeline: 'Pipeline',
};

export const BUSINESS_MODEL_TEXT: Record<BusinessModel, string> = {
  products: 'Productos',
  services: 'Servicios',
  mixed: 'Productos y servicios',
};

// ── Reglas compartidas con el servidor (solo avisos previos) ─────────────

/** Misma derivación que el backend: ambas → mixed; ninguna → null. */
export function businessModelFrom(flags: {
  sellsProducts: boolean;
  sellsServices: boolean;
}): BusinessModel | null {
  if (flags.sellsProducts && flags.sellsServices) return 'mixed';
  if (flags.sellsProducts) return 'products';
  if (flags.sellsServices) return 'services';
  return null;
}

/**
 * Tipo que el formulario del catálogo PROPONE al crear un elemento: Servicio
 * solo cuando la empresa vende exclusivamente servicios; Producto en cualquier
 * otro caso (incluida una empresa legacy sin modelo conocido). Es una
 * sugerencia visible que el usuario confirma; el backend sigue mandando.
 */
export function suggestedItemType(
  config: TenantConfiguration | null | undefined,
): CatalogItemType {
  return config?.identity.businessModel === 'services' ? 'SERVICE' : 'PRODUCT';
}

/** NULL o ausente (producto anterior a la Fase 2) → Producto. */
export function effectiveItemType(
  stored: CatalogItemType | null | undefined,
): CatalogItemType {
  return stored ?? 'PRODUCT';
}

const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function supportedValues(key: 'timeZone' | 'currency'): Set<string> | null {
  const intl = Intl as unknown as {
    supportedValuesOf?: (k: 'timeZone' | 'currency') => string[];
  };
  if (typeof intl.supportedValuesOf !== 'function') return null;
  try {
    return new Set(intl.supportedValuesOf(key));
  } catch {
    return null;
  }
}

/** Zonas IANA que conoce el navegador, para sugerirlas. Vacío si no las expone. */
export function timezoneSuggestions(): string[] {
  return [...(supportedValues('timeZone') ?? [])].sort();
}

/** Idiomas/regiones habituales del producto, como sugerencia (texto libre). */
export const LOCALE_SUGGESTIONS = [
  'es-CO',
  'es-CR',
  'es-MX',
  'es-AR',
  'es-CL',
  'es-PE',
  'es-EC',
  'es-PA',
  'es-GT',
  'es-DO',
  'es-ES',
  'en-US',
  'pt-BR',
] as const;

export interface RegionalDraft {
  country: string;
  timezone: string;
  currency: string;
  locale: string;
}

export type RegionalDraftErrors = Partial<Record<keyof RegionalDraft, string>>;

/**
 * Aviso previo, con las mismas reglas que aplica el servidor: zona IANA,
 * ISO 4217 de tres letras, etiqueta BCP 47 y país acotado. El servidor vuelve
 * a validar TODO; esto solo evita un viaje para un error evidente.
 */
export function validateRegionalDraft(
  draft: RegionalDraft,
  limits: RegionalLimits = DEFAULT_REGIONAL_LIMITS,
): RegionalDraftErrors {
  const errors: RegionalDraftErrors = {};

  const country = draft.country.replace(/\s+/g, ' ').trim();
  if (country.length > limits.country.maxLength) {
    errors.country = `Máximo ${limits.country.maxLength} caracteres.`;
  }

  const timezone = draft.timezone.trim();
  if (!timezone) {
    errors.timezone = 'Indica la zona horaria.';
  } else if (
    timezone.length > limits.timezone.maxLength ||
    !TIMEZONE_PATTERN.test(timezone)
  ) {
    errors.timezone = 'Usa un identificador IANA, por ejemplo America/Bogota.';
  } else if (timezone !== 'UTC') {
    // Igual que el servidor: lo que `Intl` resuelve vale, incluidos los alias
    // (America/Argentina/Buenos_Aires) que no salen en `supportedValuesOf`.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      errors.timezone = 'Esa zona horaria no se reconoce.';
    }
  }

  const currency = draft.currency.trim();
  if (!CURRENCY_PATTERN.test(currency)) {
    errors.currency = 'Usa un código de tres letras, por ejemplo COP, USD o CRC.';
  } else {
    const known = supportedValues('currency');
    if (known && !known.has(currency.toUpperCase())) {
      errors.currency = 'Ese código de moneda no se reconoce.';
    }
  }

  const locale = draft.locale.trim();
  if (
    !locale ||
    locale.length > limits.locale.maxLength ||
    !LOCALE_PATTERN.test(locale)
  ) {
    errors.locale = 'Usa una etiqueta de idioma, por ejemplo es-CO o en-US.';
  } else {
    try {
      Intl.getCanonicalLocales(locale);
    } catch {
      errors.locale = 'Esa etiqueta de idioma no es válida.';
    }
  }

  return errors;
}

/** Normaliza como lo hará el servidor, para que el borrador y lo guardado coincidan. */
export function normalizeRegionalDraft(draft: RegionalDraft): RegionalDraft {
  let locale = draft.locale.trim();
  try {
    locale = Intl.getCanonicalLocales(locale)[0] ?? locale;
  } catch {
    // se deja tal cual; la validación ya lo habrá marcado
  }
  return {
    country: draft.country.replace(/\s+/g, ' ').trim(),
    timezone: draft.timezone.trim(),
    currency: draft.currency.trim().toUpperCase(),
    locale,
  };
}
