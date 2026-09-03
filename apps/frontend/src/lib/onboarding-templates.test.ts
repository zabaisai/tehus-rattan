import { describe, expect, it } from 'vitest';
import {
  categorySuggestionsFor,
  findBusinessType,
  findIndustry,
  flagsForModel,
} from './onboarding-templates';
import { TEMPLATES_FIXTURE } from './__fixtures__/onboarding-templates.fixture';

describe('onboarding-templates helpers', () => {
  it('resuelve industria y tipo por clave; devuelve undefined cuando no existen o no hay plantillas', () => {
    expect(findIndustry(TEMPLATES_FIXTURE, 'generic')?.name).toBe('Genérico');
    expect(findIndustry(TEMPLATES_FIXTURE, 'nope')).toBeUndefined();
    expect(findIndustry(null, 'generic')).toBeUndefined();
    expect(findBusinessType(TEMPLATES_FIXTURE, 'generic', 'services')?.modules.catalog).toBe(false);
    expect(findBusinessType(TEMPLATES_FIXTURE, 'generic', 'grooming')).toBeUndefined();
  });

  it('sugiere las categorías del tipo y, si el tipo no trae, las de la industria', () => {
    const generic = findIndustry(TEMPLATES_FIXTURE, 'generic');
    expect(
      categorySuggestionsFor(generic, findBusinessType(TEMPLATES_FIXTURE, 'generic', 'products')),
    ).toEqual(['Productos', 'Otros']);
    // Un tipo sin catálogo al que el usuario le activa catálogo: toda la industria.
    expect(
      categorySuggestionsFor(generic, findBusinessType(TEMPLATES_FIXTURE, 'generic', 'services')),
    ).toEqual(['Productos', 'Servicios', 'Otros']);
    expect(categorySuggestionsFor(undefined, undefined)).toEqual([]);
  });

  it('el modelo comercial deriva las banderas de venta', () => {
    expect(flagsForModel('products')).toEqual({ sellsProducts: true, sellsServices: false });
    expect(flagsForModel('services')).toEqual({ sellsProducts: false, sellsServices: true });
    expect(flagsForModel('mixed')).toEqual({ sellsProducts: true, sellsServices: true });
  });
});
