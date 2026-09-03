import api from './axios';

/**
 * Plantillas de onboarding por industria.
 *
 * La fuente de verdad vive en el backend (versionada en código y publicada
 * como `docs/contracts/onboarding-templates.v2.json`); el asistente las pide
 * al arrancar en vez de llevar una copia, para que sugerencia y validación
 * no puedan divergir. Estos tipos son un espejo del contrato.
 */

export type BusinessModel = 'products' | 'services' | 'mixed';
export type StageType = 'OPEN' | 'WON' | 'LOST';

export interface StageTemplate {
  name: string;
  type: StageType;
}

export interface PipelineTemplate {
  name: string;
  stages: StageTemplate[];
}

export interface ModulesTemplate {
  catalog: boolean;
  quotes: boolean;
  tasks: boolean;
}

export interface BusinessTypeTemplate {
  key: string;
  name: string;
  description: string;
  businessModel: BusinessModel;
  modules: ModulesTemplate;
  categories: string[];
  pipeline: PipelineTemplate;
  manual?: boolean;
}

export interface IndustryTemplate {
  key: string;
  name: string;
  description: string;
  categorySuggestions: string[];
  businessTypes: BusinessTypeTemplate[];
}

export interface OnboardingTemplates {
  version: number;
  coreModules: string[];
  industries: IndustryTemplate[];
  limits: {
    categories: { maxLength: number; maxCount: number };
    stages: { maxNameLength: number; maxCount: number };
  };
}

export const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = {
  products: 'Vendo productos',
  services: 'Vendo servicios',
  mixed: 'Vendo productos y servicios',
};

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  OPEN: 'Abierta',
  WON: 'Cierre ganado',
  LOST: 'Cierre perdido',
};

export const CORE_MODULE_LABELS: Record<string, string> = {
  conversations: 'Conversaciones',
  contacts: 'Contactos',
  leads: 'Oportunidades',
  pipeline: 'Pipeline',
};

export const OPTIONAL_MODULE_LABELS: Record<keyof ModulesTemplate, string> = {
  catalog: 'Catálogo de productos o servicios',
  quotes: 'Cotizaciones',
  tasks: 'Tareas y seguimientos',
};

export async function getOnboardingTemplates(): Promise<OnboardingTemplates> {
  const { data } = await api.get<OnboardingTemplates>('/onboarding/templates');
  return data;
}

export function findIndustry(
  templates: OnboardingTemplates | null,
  key: string,
): IndustryTemplate | undefined {
  return templates?.industries.find((i) => i.key === key);
}

export function findBusinessType(
  templates: OnboardingTemplates | null,
  industryKey: string,
  businessTypeKey: string,
): BusinessTypeTemplate | undefined {
  return findIndustry(templates, industryKey)?.businessTypes.find(
    (t) => t.key === businessTypeKey,
  );
}

/**
 * Categorías que se ofrecen para un tipo de negocio: las del tipo si las
 * trae; si no (un tipo sin catálogo al que el usuario le activó el catálogo),
 * las sugerencias de toda la industria.
 */
export function categorySuggestionsFor(
  industry: IndustryTemplate | undefined,
  type: BusinessTypeTemplate | undefined,
): string[] {
  if (!industry) return [];
  if (type && type.categories.length > 0) return type.categories;
  return industry.categorySuggestions;
}

/** Banderas comerciales derivadas del modelo. Editables después. */
export function flagsForModel(model: BusinessModel): {
  sellsProducts: boolean;
  sellsServices: boolean;
} {
  return {
    sellsProducts: model === 'products' || model === 'mixed',
    sellsServices: model === 'services' || model === 'mixed',
  };
}
