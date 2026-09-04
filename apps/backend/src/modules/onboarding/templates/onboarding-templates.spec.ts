import * as fs from 'fs';
import * as path from 'path';
import {
  BUSINESS_MODELS,
  CORE_MODULES,
  findBusinessType,
  findIndustry,
  ONBOARDING_TEMPLATES,
  ONBOARDING_TEMPLATES_VERSION,
} from './onboarding-templates';
import {
  CATEGORY_LIMITS,
  normalizeCategories,
  validateTypedStages,
} from '../../companies/company-settings';

const REQUIRED_INDUSTRIES = [
  'generic',
  'retail_ecommerce',
  'furniture_decor',
  'veterinary_pet',
  'professional_services',
  'real_estate',
  'automotive',
];

const KEY_FORMAT = /^[a-z][a-z0-9_]*$/;

// Términos que solo pueden aparecer dentro de la plantilla de muebles.
const FURNITURE_TERMS =
  /\b(salas?|comedor(es)?|sillas?|muebles|primavera|rat[aá]n)\b/i;
// Términos médicos que NO deben aparecer: TAKTO es un CRM comercial.
const MEDICAL_TERMS =
  /\b(historia cl[ií]nica|diagn[oó]stico m[eé]dico|receta|tratamiento)\b/i;

describe('Plantillas de onboarding (v3, versionadas en código)', () => {
  it('declara la versión y los módulos centrales', () => {
    expect(ONBOARDING_TEMPLATES.version).toBe(ONBOARDING_TEMPLATES_VERSION);
    expect(ONBOARDING_TEMPLATES.coreModules).toEqual(CORE_MODULES);
    expect(CORE_MODULES).toEqual([
      'conversations',
      'contacts',
      'leads',
      'pipeline',
    ]);
  });

  it('incluye como mínimo las industrias exigidas, con claves únicas y en formato snake_case', () => {
    const keys = ONBOARDING_TEMPLATES.industries.map((i) => i.key);
    for (const required of REQUIRED_INDUSTRIES)
      expect(keys).toContain(required);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(KEY_FORMAT);
    expect(keys[0]).toBe('generic');
  });

  it('cada industria tiene nombre y descripción en español no vacíos y tipos de negocio', () => {
    for (const industry of ONBOARDING_TEMPLATES.industries) {
      expect(industry.name.trim().length).toBeGreaterThan(0);
      expect(industry.description.trim().length).toBeGreaterThan(0);
      expect(industry.businessTypes.length).toBeGreaterThanOrEqual(2);
      const typeKeys = industry.businessTypes.map((t) => t.key);
      expect(new Set(typeKeys).size).toBe(typeKeys.length);
      for (const key of typeKeys) expect(key).toMatch(KEY_FORMAT);
      // Siempre existe «Otro / Configurar manualmente», y es el último.
      const manual = industry.businessTypes.filter((t) => t.manual);
      expect(manual).toHaveLength(1);
      expect(manual[0].key).toBe('other');
      expect(manual[0].name).toBe('Otro / Configurar manualmente');
      expect(
        industry.businessTypes[industry.businessTypes.length - 1].manual,
      ).toBe(true);
    }
  });

  it('cubre los tipos de negocio mínimos por industria', () => {
    const expectTypes = (industry: string, types: string[]) => {
      const keys = findIndustry(industry)!.businessTypes.map((t) => t.key);
      for (const t of types) expect(keys).toContain(t);
    };
    expectTypes('generic', ['products', 'services', 'mixed']);
    expectTypes('retail_ecommerce', [
      'physical_store',
      'ecommerce',
      'wholesale',
    ]);
    expectTypes('furniture_decor', [
      'showroom',
      'interior_design',
      'custom_manufacturing',
    ]);
    expectTypes('veterinary_pet', [
      'vet_petshop',
      'clinic',
      'pet_shop',
      'grooming',
      'boarding',
    ]);
    expectTypes('professional_services', [
      'software',
      'consulting',
      'agency',
      'technical_services',
      'projects',
    ]);
    expectTypes('real_estate', ['sale', 'rent', 'new_projects']);
    expectTypes('automotive', ['dealership', 'workshop', 'parts']);
  });

  it('cada tipo de negocio es coherente: modelo válido, módulos booleanos, categorías normalizadas y pipeline válido', () => {
    for (const industry of ONBOARDING_TEMPLATES.industries) {
      const industrySuggestions = normalizeCategories(
        industry.categorySuggestions,
        { strict: true },
      );
      expect(industrySuggestions).toEqual(industry.categorySuggestions);
      expect(industrySuggestions.length).toBeLessThanOrEqual(
        CATEGORY_LIMITS.maxCount,
      );

      for (const type of industry.businessTypes) {
        expect(type.name.trim().length).toBeGreaterThan(0);
        expect(type.description.trim().length).toBeGreaterThan(0);
        expect(BUSINESS_MODELS).toContain(type.businessModel);
        for (const flag of Object.values(type.modules))
          expect(typeof flag).toBe('boolean');

        // Categorías: ya normalizadas, sin duplicados ni espacios, dentro de límites.
        expect(normalizeCategories(type.categories, { strict: true })).toEqual(
          type.categories,
        );
        // Sin catálogo no se sugieren categorías: no se pide configurar lo que no se usa.
        if (!type.modules.catalog) expect(type.categories).toEqual([]);
        // Las categorías del tipo salen de las de la industria (subconjunto relevante).
        for (const c of type.categories)
          expect(industry.categorySuggestions).toContain(c);

        // Pipeline con tipos explícitos, orden conservado y salidas al final.
        expect(type.pipeline.name.trim().length).toBeGreaterThan(0);
        const validated = validateTypedStages(type.pipeline.stages);
        expect(validated).toEqual(type.pipeline.stages);
        const types = type.pipeline.stages.map((s) => s.type);
        expect(types[0]).toBe('OPEN');
        expect(types.slice(-2)).toEqual(['WON', 'LOST']);
      }
    }
  });

  it('los términos de muebles solo aparecen en la plantilla de muebles', () => {
    for (const industry of ONBOARDING_TEMPLATES.industries) {
      const texto = JSON.stringify(industry);
      if (industry.key === 'furniture_decor') {
        expect(texto).toMatch(FURNITURE_TERMS);
      } else {
        expect(texto).not.toMatch(FURNITURE_TERMS);
      }
      expect(texto).not.toMatch(/tehus/i);
    }
  });

  it('veterinaria y mascotas es estrictamente comercial: sin funciones médicas', () => {
    const vet = findIndustry('veterinary_pet')!;
    expect(JSON.stringify(vet)).not.toMatch(MEDICAL_TERMS);
    for (const type of vet.businessTypes) {
      for (const stage of type.pipeline.stages) {
        expect(stage.name).not.toMatch(MEDICAL_TERMS);
      }
    }
  });

  it('findBusinessType resuelve claves válidas y devuelve undefined para desconocidas', () => {
    expect(findBusinessType('generic', 'services')?.modules.catalog).toBe(
      false,
    );
    expect(findBusinessType('generic', 'nope')).toBeUndefined();
    expect(findBusinessType('nope', 'services')).toBeUndefined();
  });

  it('el contrato publicado docs/contracts/onboarding-templates.v3.json es exactamente esta exportación', () => {
    // Si este test falla, regenerar el JSON desde el código (ver el README de
    // la Fase 1): el documento nunca se edita a mano.
    const file = path.resolve(
      __dirname,
      '../../../../../../docs/contracts/onboarding-templates.v3.json',
    );
    const published = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(published).toEqual(JSON.parse(JSON.stringify(ONBOARDING_TEMPLATES)));
  });
});
