import type { OnboardingCompanyPayload } from './onboarding';
import {
  categorySuggestionsFor,
  findBusinessType,
  findIndustry,
  flagsForModel,
  type BusinessModel,
  type BusinessTypeTemplate,
  type IndustryTemplate,
  type ModulesTemplate,
  type OnboardingTemplates,
  type StageTemplate,
} from './onboarding-templates';
import { normalizeCategoryList } from './company-settings';
import { normalizeRegionalDraft, type RegionalDraft } from './tenant-configuration';

/**
 * Estado del asistente y su ÚNICA traducción al contrato del servidor.
 *
 * El resumen final se pinta desde `buildOnboardingPayload(estado)`, el mismo
 * objeto que se envía: así no puede mostrar una cosa y mandar otra.
 */

export interface CompanyInfoState {
  name: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  description: string;
}

export interface PipelineState {
  name: string;
  stages: StageTemplate[];
}

export interface AdminState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface AgentDraft {
  name: string;
  email: string;
  password: string;
}

export interface BrandingColorState {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
}

export interface WizardState {
  company: CompanyInfoState;
  industry: string;
  regional: RegionalDraft;
  businessModel: BusinessModel;
  /** Clave de la plantilla (tipo de negocio) elegida; `other` = manual. */
  businessType: string;
  /** Solo para «Otro / Configurar manualmente». */
  customBusinessType: string;
  modules: ModulesTemplate;
  categories: string[];
  pipeline: PipelineState;
  colors: BrandingColorState;
  admin: AdminState;
  agents: AgentDraft[];
}

/** Qué secciones cambió la persona respecto a la recomendación. */
export interface EditedFlags {
  regional: boolean;
  businessModel: boolean;
  modules: boolean;
  categories: boolean;
  pipeline: boolean;
}

export const NOTHING_EDITED: EditedFlags = {
  regional: false,
  businessModel: false,
  modules: false,
  categories: false,
  pipeline: false,
};

export const MANUAL_MODULES: ModulesTemplate = { catalog: false, quotes: false, tasks: true };

/**
 * Plantilla recomendada para una industria y una forma de vender: la primera
 * (no manual) cuyo modelo coincide; si ninguna coincide, la primera no manual.
 * Determinista: el orden del catálogo es el orden de preferencia.
 */
export function recommendedBusinessType(
  industry: IndustryTemplate | undefined,
  model: BusinessModel | null,
): BusinessTypeTemplate | undefined {
  if (!industry) return undefined;
  const candidates = industry.businessTypes.filter((t) => !t.manual);
  if (candidates.length === 0) return undefined;
  return (model && candidates.find((t) => t.businessModel === model)) || candidates[0];
}

/** Forma de vender que la industria sugiere antes de elegir plantilla. */
export function recommendedModelFor(industry: IndustryTemplate | undefined): BusinessModel {
  return recommendedBusinessType(industry, null)?.businessModel ?? 'mixed';
}

const MODEL_TEXT: Record<BusinessModel, string> = {
  products: 'vendes productos',
  services: 'vendes servicios',
  mixed: 'vendes productos y servicios',
};

/** Motivo breve y legible de la recomendación. */
export function recommendationReason(
  industry: IndustryTemplate | undefined,
  type: BusinessTypeTemplate | undefined,
  model: BusinessModel,
): string {
  if (!industry || !type) return '';
  if (type.manual) {
    return 'Empiezas sin sugerencias: tú decides módulos, categorías y etapas.';
  }
  const modules = [
    type.modules.catalog ? 'catálogo' : null,
    type.modules.quotes ? 'cotizaciones' : null,
    type.modules.tasks ? 'tareas' : null,
  ].filter(Boolean);
  const modelMatch = type.businessModel === model;
  const base = `Porque tu empresa es de ${industry.name.toLocaleLowerCase('es')} y ${MODEL_TEXT[model]}`;
  const fit = modelMatch
    ? ''
    : ` (la plantilla está pensada para quien ${MODEL_TEXT[type.businessModel]}; conservamos tu forma de vender)`;
  const mods = modules.length > 0 ? `: activa ${modules.join(', ')}` : '';
  return `${base}${fit}${mods}, propone ${type.categories.length > 0 ? `${type.categories.length} categorías` : 'categorías a tu medida'} y un pipeline de ${type.pipeline.stages.length} etapas.`;
}

/** Lo que una plantilla sugiere para las tres secciones editables. */
export function suggestionsFrom(type: BusinessTypeTemplate | undefined): {
  modules: ModulesTemplate;
  categories: string[];
  pipeline: PipelineState;
} {
  if (!type) {
    return { modules: { ...MANUAL_MODULES }, categories: [], pipeline: { name: 'Ventas', stages: [] } };
  }
  return {
    modules: { ...type.modules },
    categories: [...type.categories],
    pipeline: { name: type.pipeline.name, stages: type.pipeline.stages.map((s) => ({ ...s })) },
  };
}

/** Categorías que se ofrecen en el paso de categorías para el estado actual. */
export function categorySuggestions(templates: OnboardingTemplates | null, state: WizardState): string[] {
  const industry = findIndustry(templates, state.industry);
  const type = findBusinessType(templates, state.industry, state.businessType);
  return categorySuggestionsFor(industry, type);
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Construye el payload EXACTO que se envía a `POST /onboarding/company`.
 * Puro y determinista; no toca archivos ni el código de invitación.
 */
export function buildOnboardingPayload(
  state: WizardState,
  templates: OnboardingTemplates | null,
  limits: { categories: { maxLength: number; maxCount: number } },
): OnboardingCompanyPayload {
  const type = findBusinessType(templates, state.industry, state.businessType);
  const regional = normalizeRegionalDraft(state.regional);
  const { categories } = normalizeCategoryList(state.categories, limits.categories);
  return {
    company: {
      name: collapse(state.company.name),
      // Solo con «Otro / Configurar manualmente» viaja un texto; con una
      // plantilla normal el servidor guarda el nombre canónico.
      businessType: type?.manual ? collapse(state.customBusinessType) || undefined : undefined,
      city: collapse(state.company.city) || undefined,
      country: regional.country || undefined,
      timezone: regional.timezone || undefined,
      currency: regional.currency || undefined,
      locale: regional.locale || undefined,
      phone: collapse(state.company.phone) || undefined,
      email: state.company.email.trim() || undefined,
      website: collapse(state.company.website) || undefined,
      description: state.company.description.trim() || undefined,
    },
    // Solo lo que la empresa eligió; vacío = apariencia TAKTO.
    branding: {
      primaryColor: state.colors.primaryColor.trim() || undefined,
      accentColor: state.colors.accentColor.trim() || undefined,
      backgroundColor: state.colors.backgroundColor.trim() || undefined,
    },
    commercial: {
      ...flagsForModel(state.businessModel),
      usesCatalog: state.modules.catalog,
      usesQuotes: state.modules.quotes,
      usesTasks: state.modules.tasks,
      categories: state.modules.catalog ? categories : [],
      industry: state.industry,
      businessType: state.businessType,
      businessModel: state.businessModel,
    },
    pipeline: {
      name: collapse(state.pipeline.name),
      typedStages: state.pipeline.stages.map((s) => ({ name: collapse(s.name), type: s.type })),
      templateKey: state.businessType,
    },
    admin: {
      name: collapse(state.admin.name),
      email: state.admin.email.trim(),
      password: state.admin.password,
    },
    agents: state.agents.map((agent) => ({
      name: collapse(agent.name),
      email: agent.email.trim(),
      password: agent.password,
      role: 'AGENT' as const,
    })),
  };
}
