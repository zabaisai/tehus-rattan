import { useQuery } from '@tanstack/react-query';
import api from './axios';
import type { BusinessModel } from './onboarding-templates';

/**
 * `Company.settings` visto desde el navegador.
 *
 * El backend es quien lee v1/v2 y devuelve SIEMPRE esta vista normalizada
 * (`GET /companies/me/settings`); aquí no se interpreta el JSON crudo de la
 * empresa. Los límites llegan en la respuesta para que el aviso previo del
 * formulario y la validación del servidor sean el mismo número.
 */

export interface CommercialFlags {
  sellsProducts: boolean;
  sellsServices: boolean;
  usesCatalog: boolean;
  usesQuotes: boolean;
  usesTasks: boolean;
}

export interface CompanySettingsView {
  /** 0 = sin settings, 1 = forma antigua, 2 = forma actual. */
  version: 0 | 1 | 2;
  commercial: CommercialFlags;
  catalog: { categories: string[]; allowFreeText: true };
  vertical: {
    industry: string;
    businessType: string;
    businessModel: BusinessModel;
    templateVersion: number;
  } | null;
  pipelineDefaults: { templateKey: string; stagesTyped: boolean } | null;
  limits: { categories: { maxLength: number; maxCount: number } };
}

export interface UpdateCompanySettingsPayload {
  catalog?: { categories: string[] };
  commercial?: Partial<CommercialFlags>;
}

/** Mismos valores que `CATEGORY_LIMITS` del backend; el servidor manda. */
export const DEFAULT_CATEGORY_LIMITS = { maxLength: 60, maxCount: 30 } as const;

export const COMPANY_SETTINGS_QUERY_KEY = ['company-me', 'settings'] as const;

export async function getMyCompanySettings(): Promise<CompanySettingsView> {
  const { data } = await api.get<CompanySettingsView>('/companies/me/settings');
  return data;
}

export async function updateMyCompanySettings(
  payload: UpdateCompanySettingsPayload,
): Promise<CompanySettingsView> {
  const { data } = await api.patch<CompanySettingsView>(
    '/companies/me/settings',
    payload,
  );
  return data;
}

export function useCompanySettings(enabled = true) {
  return useQuery({
    queryKey: COMPANY_SETTINGS_QUERY_KEY,
    queryFn: getMyCompanySettings,
    enabled,
  });
}

/**
 * Misma regla que `normalizeCategories` del backend: recorta, colapsa
 * espacios, descarta vacíos y duplicados sin distinguir mayúsculas, conserva
 * el orden y la primera grafía. Devuelve además un error legible si algo se
 * sale de los límites, para mostrarlo junto al campo antes de enviar.
 */
export function normalizeCategoryList(
  input: readonly string[],
  limits: { maxLength: number; maxCount: number } = DEFAULT_CATEGORY_LIMITS,
): { categories: string[]; error: string | null } {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const raw of input) {
    const value = raw.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length > limits.maxLength) {
      return {
        categories,
        error: `Cada categoría debe tener como máximo ${limits.maxLength} caracteres.`,
      };
    }
    const key = value.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(value);
  }
  if (categories.length > limits.maxCount) {
    return {
      categories,
      error: `Puedes tener como máximo ${limits.maxCount} categorías.`,
    };
  }
  return { categories, error: null };
}

/** ¿Ya existe (sin distinguir mayúsculas ni espacios)? */
export function hasCategory(list: readonly string[], candidate: string): boolean {
  const key = candidate.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
  return list.some((c) => c.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es') === key);
}
