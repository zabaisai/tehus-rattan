/**
 * CONTRATO AGREGADO DE CONFIGURACIÓN POR EMPRESA — `TenantConfigurationV1`.
 *
 * Es la vista que consume el frontend y está versionada APARTE de la forma
 * en que se guarda `Company.settings` (v0/v1/v2). Se compone de tres fuentes
 * y ninguna se duplica en otra:
 *
 *   - columnas de `Company`      → región (`country`, `timezone`, `currency`,
 *                                  `locale`) y tipo de negocio manual
 *   - `Company.settings` (JSON)  → banderas comerciales, módulos opcionales,
 *                                  categorías, plantilla de origen
 *   - `pipelines`/`pipeline_stages` → el pipeline real, nunca copiado al JSON
 *
 * Aquí viven las reglas puras (derivar, validar, normalizar, componer). La
 * lectura y la escritura con transacción están en
 * `tenant-configuration.service.ts`; los dos endpoints (`/configuration` y el
 * histórico `/settings`) pasan por ese único motor.
 */
import { BadRequestException } from '@nestjs/common';
import type { BusinessModel } from '../onboarding/templates/onboarding-templates';
import {
  CATEGORY_LIMITS,
  type CommercialFlags,
  type NormalizedCompanySettings,
} from './company-settings';
import { ZONA_POR_DEFECTO } from '../../common/time/zona-horaria';
import {
  resolveEffectiveCapabilities,
  type CapabilityDefinitionView,
  type OptionalCapabilityKey,
} from './tenant-capabilities';

export const TENANT_CONFIGURATION_CONTRACT_VERSION = 1;

/** Coinciden con los `@default` de las columnas de `Company`. */
export const REGIONAL_DEFAULTS = {
  timezone: ZONA_POR_DEFECTO,
  currency: 'COP',
  locale: 'es-CO',
} as const;

/** Límites que el servidor aplica y que el frontend recibe en la respuesta. */
export const REGIONAL_LIMITS = {
  country: { maxLength: 80 },
  timezone: { maxLength: 64 },
  currency: { length: 3 },
  locale: { maxLength: 35 },
} as const;

export type CatalogItemTypeName = 'PRODUCT' | 'SERVICE';

export interface TenantIdentity {
  /** Industria de la plantilla de onboarding; `null` en empresas sin asistente. */
  industry: string | null;
  /** Tipo de negocio: el de la plantilla o la descripción manual de la empresa. */
  businessType: string | null;
  /** Derivado de las banderas actuales, no de la plantilla de origen. */
  businessModel: BusinessModel | null;
  /** Versión de la plantilla con la que se creó la empresa, si hubo. */
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

/**
 * Capacidades efectivas (Fase 4): lo que la empresa PUEDE hacer hoy, ya
 * aplicada la regla de compatibilidad. `modules` (arriba) es el resultado;
 * aquí va lo que explica y acompaña ese resultado.
 */
export interface TenantCapabilitiesView {
  /** Opcionales activos porque la empresa nunca los declaró (legacy). */
  legacyDefaultsApplied: OptionalCapabilityKey[];
  catalog: {
    allowedItemTypes: CatalogItemTypeName[];
    defaultItemType: CatalogItemTypeName;
  };
  definitions: CapabilityDefinitionView[];
}

export interface TenantConfigurationV1 {
  contractVersion: 1;
  storageVersion: 0 | 1 | 2;
  identity: TenantIdentity;
  regional: TenantRegional;
  modules: TenantModules;
  capabilities: TenantCapabilitiesView;
  catalog: { categories: string[]; allowFreeText: true };
  pipeline: TenantPipeline | null;
  limits: {
    categories: typeof CATEGORY_LIMITS;
    regional: typeof REGIONAL_LIMITS;
  };
}

/** Lo que el motor lee de la fila de `companies` para componer el contrato. */
export interface CompanyConfigurationRow {
  country: string | null;
  timezone: string | null;
  currency: string | null;
  locale: string | null;
  businessType: string | null;
}

// ── Derivaciones ─────────────────────────────────────────────────────────

/**
 * Modelo comercial a partir de las banderas. Una empresa legacy sin ninguna
 * bandera en `true` no tiene modelo conocido: `null`, no una suposición.
 */
export function deriveBusinessModel(flags: {
  sellsProducts: boolean;
  sellsServices: boolean;
}): BusinessModel | null {
  if (flags.sellsProducts && flags.sellsServices) return 'mixed';
  if (flags.sellsProducts) return 'products';
  if (flags.sellsServices) return 'services';
  return null;
}

/**
 * Módulos EFECTIVOS. Antes de la Fase 4 se derivaban de las banderas
 * normalizadas, cuyo default es `false`: una empresa sin settings aparecía
 * sin catálogo, cotizaciones ni tareas aunque las usara a diario. Ahora la
 * fuente es la resolución de capacidades, que aplica el default de
 * compatibilidad a lo que nunca se declaró.
 */
export function deriveModules(
  settings: Pick<NormalizedCompanySettings, 'declaredFlags'>,
): TenantModules {
  return resolveEffectiveCapabilities(settings).modules;
}

/** Banderas tal cual: solo para quien necesite el dato bruto, no los módulos. */
export function modulesFromFlags(flags: CommercialFlags): TenantModules {
  return {
    conversations: true,
    contacts: true,
    opportunities: true,
    pipeline: true,
    catalog: flags.usesCatalog,
    quotes: flags.usesQuotes,
    tasks: flags.usesTasks,
  };
}

// ── Validación y normalización regional ──────────────────────────────────

/**
 * Identificador IANA: `Area/Ciudad` (con más niveles opcionales) o `UTC`.
 * Rechaza a propósito los desplazamientos (`+05:00`) que `Intl` acepta desde
 * Node 22: no son zonas, no tienen horario de verano y no describen un lugar.
 */
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function textOrThrow(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} debe ser un texto`);
  }
  return value.trim();
}

/** Zona horaria IANA válida, en su forma canónica (`america/bogota` → `America/Bogota`). */
export function normalizeTimezone(input: unknown): string {
  const value = textOrThrow(input, 'regional.timezone');
  const invalid = new BadRequestException(
    'regional.timezone debe ser una zona horaria IANA válida, por ejemplo America/Bogota o America/Costa_Rica',
  );
  if (
    !value ||
    value.length > REGIONAL_LIMITS.timezone.maxLength ||
    !TIMEZONE_PATTERN.test(value)
  ) {
    throw invalid;
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    throw invalid;
  }
}

let knownCurrencies: Set<string> | null = null;
function currencyCatalog(): Set<string> | null {
  if (knownCurrencies) return knownCurrencies;
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: 'currency') => string[];
  };
  if (typeof intl.supportedValuesOf !== 'function') return null;
  knownCurrencies = new Set(intl.supportedValuesOf('currency'));
  return knownCurrencies;
}

/** Código ISO 4217 de tres letras, en mayúsculas (`cop` → `COP`). */
export function normalizeCurrency(input: unknown): string {
  const value = textOrThrow(input, 'regional.currency');
  const invalid = new BadRequestException(
    'regional.currency debe ser un código ISO 4217 de tres letras, por ejemplo COP, USD o CRC',
  );
  if (!CURRENCY_PATTERN.test(value)) throw invalid;
  const code = value.toUpperCase();
  const catalog = currencyCatalog();
  if (catalog && !catalog.has(code)) throw invalid;
  return code;
}

/** Etiqueta BCP 47 válida y canonicalizada (`es-co` → `es-CO`). */
export function normalizeLocale(input: unknown): string {
  const value = textOrThrow(input, 'regional.locale');
  const invalid = new BadRequestException(
    'regional.locale debe ser una etiqueta de idioma válida (BCP 47), por ejemplo es-CO, es-CR o en-US',
  );
  if (
    !value ||
    value.length > REGIONAL_LIMITS.locale.maxLength ||
    !LOCALE_PATTERN.test(value)
  ) {
    throw invalid;
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    if (!canonical) throw invalid;
    // Debe tener idioma real; `Intl.Locale` lanza si la etiqueta no lo es.
    const language = new Intl.Locale(canonical).language;
    if (!language || language.length < 2) throw invalid;
    return canonical;
  } catch {
    throw invalid;
  }
}

/**
 * País como texto libre (compatibilidad con la columna actual): se colapsan
 * espacios y se acota la longitud. Vacío o `null` limpian el campo. No se
 * fuerza ningún catálogo para no invalidar textos históricos.
 */
export function normalizeCountry(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const value = textOrThrow(input, 'regional.country').replace(/\s+/g, ' ');
  if (!value) return null;
  if (value.length > REGIONAL_LIMITS.country.maxLength) {
    throw new BadRequestException(
      `regional.country debe tener como máximo ${REGIONAL_LIMITS.country.maxLength} caracteres`,
    );
  }
  return value;
}

export interface RegionalPatchInput {
  country?: string | null;
  timezone?: string;
  currency?: string;
  locale?: string;
}

export interface NormalizedRegionalPatch {
  country?: string | null;
  timezone?: string;
  currency?: string;
  locale?: string;
}

/** Valida y normaliza SOLO los campos presentes. Lanza 400 antes de tocar la base. */
export function normalizeRegionalPatch(
  patch: RegionalPatchInput | undefined,
): NormalizedRegionalPatch {
  const out: NormalizedRegionalPatch = {};
  if (!patch) return out;
  if (patch.country !== undefined)
    out.country = normalizeCountry(patch.country);
  if (patch.timezone !== undefined)
    out.timezone = normalizeTimezone(patch.timezone);
  if (patch.currency !== undefined)
    out.currency = normalizeCurrency(patch.currency);
  if (patch.locale !== undefined) out.locale = normalizeLocale(patch.locale);
  return out;
}

// ── Lectura segura de las columnas ───────────────────────────────────────

function safeTimezone(value: string | null): string {
  if (!value) return REGIONAL_DEFAULTS.timezone;
  try {
    return normalizeTimezone(value);
  } catch {
    return REGIONAL_DEFAULTS.timezone;
  }
}

function safeCurrency(value: string | null): string {
  if (!value) return REGIONAL_DEFAULTS.currency;
  try {
    return normalizeCurrency(value);
  } catch {
    return REGIONAL_DEFAULTS.currency;
  }
}

function safeLocale(value: string | null): string {
  if (!value) return REGIONAL_DEFAULTS.locale;
  try {
    return normalizeLocale(value);
  } catch {
    return REGIONAL_DEFAULTS.locale;
  }
}

/**
 * Región efectiva. Una columna con texto inválido histórico NO rompe la
 * lectura ni se reescribe: se responde el valor por defecto del producto,
 * igual que hace `zonaSegura` para el motor de bots.
 */
export function readRegional(row: CompanyConfigurationRow): TenantRegional {
  return {
    country: row.country?.trim() || null,
    timezone: safeTimezone(row.timezone),
    currency: safeCurrency(row.currency),
    locale: safeLocale(row.locale),
  };
}

// ── Composición del contrato ─────────────────────────────────────────────

export function buildTenantConfiguration(input: {
  company: CompanyConfigurationRow;
  settings: NormalizedCompanySettings;
  pipeline: TenantPipeline | null;
}): TenantConfigurationV1 {
  const { company, settings, pipeline } = input;
  const businessType =
    settings.vertical?.businessType ?? company.businessType?.trim() ?? null;
  const capabilities = resolveEffectiveCapabilities(settings);
  return {
    contractVersion: TENANT_CONFIGURATION_CONTRACT_VERSION,
    storageVersion: settings.storedVersion,
    identity: {
      industry: settings.vertical?.industry ?? null,
      businessType: businessType || null,
      businessModel: deriveBusinessModel(settings.commercial),
      templateVersion: settings.vertical?.templateVersion ?? null,
    },
    regional: readRegional(company),
    modules: capabilities.modules,
    capabilities: {
      legacyDefaultsApplied: capabilities.legacyDefaultsApplied,
      catalog: capabilities.catalog,
      definitions: capabilities.definitions,
    },
    catalog: {
      categories: [...settings.catalog.categories],
      allowFreeText: true,
    },
    pipeline,
    limits: { categories: CATEGORY_LIMITS, regional: REGIONAL_LIMITS },
  };
}

/** Tipo efectivo de un elemento del catálogo: una fila legacy sin tipo es un producto. */
export function effectiveCatalogItemType(
  stored: CatalogItemTypeName | null | undefined,
): CatalogItemTypeName {
  return stored ?? 'PRODUCT';
}
