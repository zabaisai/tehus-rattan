/**
 * `Company.settings` — parser y normalizador CENTRAL.
 *
 * Hoy conviven dos formas en la base:
 *
 *   v1 (sin `version`): { sellsProducts, sellsServices, usesCatalog,
 *       usesQuotes, usesTasks, categories } — lo que escribía el onboarding
 *       hasta la Fase 0. Se sigue aceptando tal cual y NUNCA se reescribe
 *       por su cuenta (sin backfill).
 *   v2 (`version: 2`): { version, commercial, catalog, vertical?,
 *       pipelineDefaults? } — lo que escriben las empresas nuevas.
 *
 * Reglas:
 *   - Leer cualquiera de las dos y devolver la MISMA vista normalizada.
 *   - Conservar las claves desconocidas al volver a escribir.
 *   - Validar en el servidor con límites compartidos (los mismos que usa el
 *     frontend para avisar antes de enviar).
 */
import { BadRequestException } from '@nestjs/common';
import type {
  BusinessModel,
  StageType,
} from '../onboarding/templates/onboarding-templates';
import { BUSINESS_MODELS } from '../onboarding/templates/onboarding-templates';

export const COMPANY_SETTINGS_VERSION = 2;

/** Límites compartidos con el frontend (ver `lib/company-settings.ts`). */
export const CATEGORY_LIMITS = {
  maxLength: 60,
  maxCount: 30,
} as const;

/** Descripción manual del tipo de negocio («Otro / Configurar manualmente»). */
export const BUSINESS_TYPE_LIMITS = {
  maxLength: 60,
} as const;

export const STAGE_LIMITS = {
  maxNameLength: 40,
  maxCount: 20,
} as const;

export interface CommercialFlags {
  sellsProducts: boolean;
  sellsServices: boolean;
  usesCatalog: boolean;
  usesQuotes: boolean;
  usesTasks: boolean;
}

export interface VerticalInfo {
  industry: string;
  businessType: string;
  businessModel: BusinessModel;
  templateVersion: number;
}

export interface PipelineDefaultsInfo {
  templateKey: string;
  stagesTyped: boolean;
}

export interface CompanySettingsV2 {
  version: 2;
  commercial: CommercialFlags;
  catalog: { categories: string[]; allowFreeText: true };
  vertical?: VerticalInfo;
  pipelineDefaults?: PipelineDefaultsInfo;
  [unknown: string]: unknown;
}

/** Vista normalizada, independiente de la versión guardada. */
export interface NormalizedCompanySettings {
  /** 0 = sin settings, 1 = forma antigua, 2 = forma actual. */
  storedVersion: 0 | 1 | 2;
  commercial: CommercialFlags;
  catalog: { categories: string[]; allowFreeText: true };
  vertical: VerticalInfo | null;
  pipelineDefaults: PipelineDefaultsInfo | null;
  /** Claves que no pertenecen al contrato; se conservan al escribir. */
  extra: Record<string, unknown>;
}

const DEFAULT_COMMERCIAL: CommercialFlags = {
  sellsProducts: false,
  sellsServices: false,
  usesCatalog: false,
  usesQuotes: false,
  usesTasks: false,
};

const COMMERCIAL_KEYS: (keyof CommercialFlags)[] = [
  'sellsProducts',
  'sellsServices',
  'usesCatalog',
  'usesQuotes',
  'usesTasks',
];

const V1_KEYS = new Set<string>([...COMMERCIAL_KEYS, 'categories']);
const V2_KEYS = new Set<string>([
  'version',
  'commercial',
  'catalog',
  'vertical',
  'pipelineDefaults',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flagsFrom(source: Record<string, unknown>): CommercialFlags {
  const out = { ...DEFAULT_COMMERCIAL };
  for (const key of COMMERCIAL_KEYS) {
    if (typeof source[key] === 'boolean') out[key] = source[key];
  }
  return out;
}

/**
 * Limpia una lista de categorías tal como la envía un formulario: recorta,
 * descarta vacíos y duplicados (sin distinguir mayúsculas ni acentos de
 * espaciado), y aplica los límites. Conserva el orden y la primera grafía.
 * `strict` lanza 400 en vez de recortar en silencio: es lo que usa la API.
 */
export function normalizeCategories(
  input: unknown,
  opts: { strict?: boolean } = {},
): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    if (opts.strict) {
      throw new BadRequestException('categories debe ser una lista de textos');
    }
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') {
      if (opts.strict) {
        throw new BadRequestException('Cada categoría debe ser un texto');
      }
      continue;
    }
    const value = raw.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length > CATEGORY_LIMITS.maxLength) {
      if (opts.strict) {
        throw new BadRequestException(
          `Cada categoría debe tener como máximo ${CATEGORY_LIMITS.maxLength} caracteres`,
        );
      }
      continue;
    }
    const key = value.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length > CATEGORY_LIMITS.maxCount) {
    if (opts.strict) {
      throw new BadRequestException(
        `Máximo ${CATEGORY_LIMITS.maxCount} categorías`,
      );
    }
    return out.slice(0, CATEGORY_LIMITS.maxCount);
  }
  return out;
}

function parseVertical(value: unknown): VerticalInfo | null {
  if (!isRecord(value)) return null;
  const { industry, businessType, businessModel, templateVersion } = value;
  if (
    typeof industry !== 'string' ||
    typeof businessType !== 'string' ||
    typeof businessModel !== 'string' ||
    !BUSINESS_MODELS.includes(businessModel as BusinessModel) ||
    typeof templateVersion !== 'number'
  ) {
    return null;
  }
  return {
    industry,
    businessType,
    businessModel: businessModel as BusinessModel,
    templateVersion,
  };
}

function parsePipelineDefaults(value: unknown): PipelineDefaultsInfo | null {
  if (!isRecord(value)) return null;
  const { templateKey, stagesTyped } = value;
  if (typeof templateKey !== 'string' || typeof stagesTyped !== 'boolean') {
    return null;
  }
  return { templateKey, stagesTyped };
}

/**
 * Lee `Company.settings` en cualquiera de sus formas. Nunca lanza: un valor
 * corrupto se trata como «sin settings» conservando lo desconocido, porque
 * una empresa existente no debe dejar de cargar por un JSON raro.
 */
export function parseCompanySettings(raw: unknown): NormalizedCompanySettings {
  if (!isRecord(raw)) {
    return {
      storedVersion: 0,
      commercial: { ...DEFAULT_COMMERCIAL },
      catalog: { categories: [], allowFreeText: true },
      vertical: null,
      pipelineDefaults: null,
      extra: {},
    };
  }

  if (raw.version === COMPANY_SETTINGS_VERSION) {
    const commercial = isRecord(raw.commercial)
      ? flagsFrom(raw.commercial)
      : { ...DEFAULT_COMMERCIAL };
    const catalog = isRecord(raw.catalog) ? raw.catalog : {};
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!V2_KEYS.has(key)) extra[key] = value;
    }
    return {
      storedVersion: 2,
      commercial,
      catalog: {
        categories: normalizeCategories(catalog.categories),
        allowFreeText: true,
      },
      vertical: parseVertical(raw.vertical),
      pipelineDefaults: parsePipelineDefaults(raw.pipelineDefaults),
      extra,
    };
  }

  // v1: banderas planas + categories. Cualquier otra clave se conserva.
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!V1_KEYS.has(key)) extra[key] = value;
  }
  return {
    storedVersion: 1,
    commercial: flagsFrom(raw),
    catalog: {
      categories: normalizeCategories(raw.categories),
      allowFreeText: true,
    },
    vertical: null,
    pipelineDefaults: null,
    extra,
  };
}

/** Construye la forma v2 que se persiste, conservando `extra`. */
export function buildCompanySettingsV2(input: {
  commercial: CommercialFlags;
  categories: string[];
  vertical?: VerticalInfo | null;
  pipelineDefaults?: PipelineDefaultsInfo | null;
  extra?: Record<string, unknown>;
}): CompanySettingsV2 {
  const settings: CompanySettingsV2 = {
    ...(input.extra ?? {}),
    version: 2,
    commercial: { ...input.commercial },
    catalog: {
      categories: normalizeCategories(input.categories, { strict: true }),
      allowFreeText: true,
    },
  };
  if (input.vertical) settings.vertical = { ...input.vertical };
  if (input.pipelineDefaults) {
    settings.pipelineDefaults = { ...input.pipelineDefaults };
  }
  return settings;
}

/** Vista pública que devuelve la API (`GET /companies/me/settings`). */
export function toPublicSettings(parsed: NormalizedCompanySettings) {
  return {
    version: parsed.storedVersion,
    commercial: parsed.commercial,
    catalog: parsed.catalog,
    vertical: parsed.vertical,
    pipelineDefaults: parsed.pipelineDefaults,
    limits: { categories: CATEGORY_LIMITS },
  };
}

export interface TypedStageInput {
  name: string;
  type: StageType;
}

/**
 * Invariantes de un pipeline con tipos explícitos: al menos una etapa OPEN,
 * exactamente una WON y exactamente una LOST, nombres únicos (sin distinguir
 * mayúsculas) y no vacíos, dentro de los límites. Devuelve las etapas
 * recortadas y en orden; lanza 400 si algo falla. Se usa en el onboarding y
 * en la prueba de las plantillas, para que sugerencia y validación coincidan.
 */
export function validateTypedStages(
  stages: TypedStageInput[],
): TypedStageInput[] {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new BadRequestException('El pipeline debe tener al menos una etapa');
  }
  if (stages.length > STAGE_LIMITS.maxCount) {
    throw new BadRequestException(
      `El pipeline admite como máximo ${STAGE_LIMITS.maxCount} etapas`,
    );
  }
  const seen = new Set<string>();
  const out: TypedStageInput[] = [];
  let won = 0;
  let lost = 0;
  let open = 0;
  for (const stage of stages) {
    const name = (stage?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) {
      throw new BadRequestException('Cada etapa debe tener nombre');
    }
    if (name.length > STAGE_LIMITS.maxNameLength) {
      throw new BadRequestException(
        `Cada etapa debe tener como máximo ${STAGE_LIMITS.maxNameLength} caracteres`,
      );
    }
    const key = name.toLocaleLowerCase('es');
    if (seen.has(key)) {
      throw new BadRequestException(`La etapa "${name}" está repetida`);
    }
    seen.add(key);
    if (stage.type === 'WON') won++;
    else if (stage.type === 'LOST') lost++;
    else if (stage.type === 'OPEN') open++;
    else throw new BadRequestException('type debe ser OPEN, WON o LOST');
    out.push({ name, type: stage.type });
  }
  if (open < 1) {
    throw new BadRequestException(
      'El pipeline debe tener al menos una etapa abierta (OPEN)',
    );
  }
  if (won !== 1) {
    throw new BadRequestException(
      'El pipeline debe tener exactamente una etapa de cierre ganado (WON)',
    );
  }
  if (lost !== 1) {
    throw new BadRequestException(
      'El pipeline debe tener exactamente una etapa de cierre perdido (LOST)',
    );
  }
  return out;
}
