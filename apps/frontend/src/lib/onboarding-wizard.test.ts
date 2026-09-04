import { describe, expect, it } from 'vitest';
import {
  buildOnboardingPayload,
  recommendationReason,
  recommendedBusinessType,
  recommendedModelFor,
  suggestionsFrom,
  type WizardState,
} from './onboarding-wizard';
import { TEMPLATES_FIXTURE } from './__fixtures__/onboarding-templates.fixture';
import { findIndustry } from './onboarding-templates';

const LIMITS = { categories: { maxLength: 60, maxCount: 30 } };

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    company: { name: '  Muebles   QA ', city: ' Medellín ', phone: '', email: ' a@b.co ', website: '', description: '' },
    industry: 'furniture_decor',
    regional: { country: 'Colombia', timezone: ' america/bogota ', currency: 'cop', locale: 'es-co' },
    businessModel: 'mixed',
    businessType: 'showroom',
    customBusinessType: '',
    modules: { catalog: true, quotes: true, tasks: true },
    categories: ['Salas', ' salas ', 'Comedores'],
    pipeline: {
      name: ' Ventas ',
      stages: [
        { name: ' Nuevo  lead ', type: 'OPEN' },
        { name: 'Ganado', type: 'WON' },
        { name: 'Perdido', type: 'LOST' },
      ],
    },
    colors: { primaryColor: '', accentColor: '', backgroundColor: '' },
    admin: { name: ' Ana ', email: ' ana@example.test ', password: 'Segura!12345', confirmPassword: 'Segura!12345' },
    agents: [{ name: 'Luis', email: 'luis@example.test', password: 'Segura!12345' }],
    ...over,
  };
}

describe('recomendaciones', () => {
  const furniture = findIndustry(TEMPLATES_FIXTURE, 'furniture_decor');
  const vet = findIndustry(TEMPLATES_FIXTURE, 'veterinary_pet');
  const generic = findIndustry(TEMPLATES_FIXTURE, 'generic');

  it('recommendedBusinessType prefiere la primera plantilla no manual que coincide con la forma de vender', () => {
    expect(recommendedBusinessType(generic, 'services')?.key).toBe('services');
    expect(recommendedBusinessType(generic, 'products')?.key).toBe('products');
    // Sin coincidencia exacta cae a la primera no manual, nunca a «Otro».
    expect(recommendedBusinessType(vet, 'mixed')?.key).toBe('grooming');
    expect(recommendedBusinessType(vet, 'mixed')?.manual).toBeFalsy();
    expect(recommendedBusinessType(undefined, 'mixed')).toBeUndefined();
  });

  it('recommendedModelFor sugiere el modelo de la primera plantilla de la industria', () => {
    expect(recommendedModelFor(furniture)).toBe('products');
    expect(recommendedModelFor(vet)).toBe('services');
    expect(recommendedModelFor(undefined)).toBe('mixed');
  });

  it('recommendationReason explica industria, forma de vender, módulos, categorías y etapas en español', () => {
    const type = furniture!.businessTypes.find((t) => t.key === 'showroom')!;
    const reason = recommendationReason(furniture, type, 'products');
    expect(reason).toMatch(/muebles y decoración/i);
    expect(reason).toMatch(/vendes productos/);
    expect(reason).toMatch(/catálogo/);
    expect(reason).toMatch(/categorías/);
    expect(reason).toMatch(/etapas/);
    expect(reason).not.toMatch(/PRODUCT|vertical|pipelineDefaults/);
  });

  it('si la forma de vender no coincide con la plantilla, lo dice y conserva la de la persona', () => {
    const type = furniture!.businessTypes.find((t) => t.key === 'showroom')!;
    expect(recommendationReason(furniture, type, 'services')).toMatch(/conservamos tu forma de vender/);
  });

  it('la plantilla manual se explica sin sugerencias', () => {
    const other = generic!.businessTypes.find((t) => t.manual)!;
    expect(recommendationReason(generic, other, 'mixed')).toMatch(/sin sugerencias/i);
    expect(suggestionsFrom(other).categories).toEqual([]);
  });

  it('suggestionsFrom copia (no comparte referencias) módulos, categorías y etapas', () => {
    const type = furniture!.businessTypes.find((t) => t.key === 'showroom')!;
    const s = suggestionsFrom(type);
    s.categories.push('X');
    s.pipeline.stages[0].name = 'cambiado';
    expect(type.categories).not.toContain('X');
    expect(type.pipeline.stages[0].name).not.toBe('cambiado');
  });
});

describe('buildOnboardingPayload', () => {
  it('normaliza texto, región (Fase 2) y categorías, y deriva las banderas de la forma de vender', () => {
    const payload = buildOnboardingPayload(state(), TEMPLATES_FIXTURE, LIMITS);
    expect(payload.company).toEqual({
      name: 'Muebles QA',
      businessType: undefined,
      city: 'Medellín',
      country: 'Colombia',
      timezone: 'america/bogota',
      currency: 'COP',
      locale: 'es-CO',
      phone: undefined,
      email: 'a@b.co',
      website: undefined,
      description: undefined,
    });
    expect(payload.commercial).toEqual({
      sellsProducts: true,
      sellsServices: true,
      usesCatalog: true,
      usesQuotes: true,
      usesTasks: true,
      categories: ['Salas', 'Comedores'],
      industry: 'furniture_decor',
      businessType: 'showroom',
      businessModel: 'mixed',
    });
    expect(payload.pipeline).toEqual({
      name: 'Ventas',
      typedStages: [
        { name: 'Nuevo lead', type: 'OPEN' },
        { name: 'Ganado', type: 'WON' },
        { name: 'Perdido', type: 'LOST' },
      ],
      templateKey: 'showroom',
    });
    expect(payload.admin).toEqual({ name: 'Ana', email: 'ana@example.test', password: 'Segura!12345' });
    expect(payload.agents).toEqual([{ name: 'Luis', email: 'luis@example.test', password: 'Segura!12345', role: 'AGENT' }]);
    // La zona horaria la canonicaliza el servidor (IANA); el cliente solo recorta.
    expect(payload.branding).toEqual({ primaryColor: undefined, accentColor: undefined, backgroundColor: undefined });
  });

  it('sin catálogo no envía categorías aunque estén marcadas', () => {
    const payload = buildOnboardingPayload(
      state({ modules: { catalog: false, quotes: true, tasks: true } }),
      TEMPLATES_FIXTURE,
      LIMITS,
    );
    expect(payload.commercial.categories).toEqual([]);
    expect(payload.commercial.usesCatalog).toBe(false);
  });

  it('solo «Otro / Configurar manualmente» envía el tipo de negocio manual, recortado', () => {
    const payload = buildOnboardingPayload(
      state({ industry: 'generic', businessType: 'other', customBusinessType: '  Insumos   agrícolas ' }),
      TEMPLATES_FIXTURE,
      LIMITS,
    );
    expect(payload.company.businessType).toBe('Insumos agrícolas');
    expect(payload.commercial.businessType).toBe('other');
  });

  it('región vacía → no viaja (el servidor aplica sus defaults)', () => {
    const payload = buildOnboardingPayload(
      state({ regional: { country: '', timezone: '', currency: '', locale: '' } }),
      TEMPLATES_FIXTURE,
      LIMITS,
    );
    expect(payload.company.country).toBeUndefined();
    expect(payload.company.timezone).toBeUndefined();
    expect(payload.company.currency).toBeUndefined();
    expect(payload.company.locale).toBeUndefined();
  });

  it('es determinista: el mismo estado produce el mismo payload (lo que ve el resumen es lo que se envía)', () => {
    const a = buildOnboardingPayload(state(), TEMPLATES_FIXTURE, LIMITS);
    const b = buildOnboardingPayload(state(), TEMPLATES_FIXTURE, LIMITS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toMatch(/tehus|A57014/i);
  });
});
