import { describe, expect, it } from 'vitest';
import {
  businessModelFrom,
  effectiveItemType,
  normalizeRegionalDraft,
  suggestedItemType,
  validateRegionalDraft,
  type TenantConfiguration,
} from './tenant-configuration';

function config(over: Partial<TenantConfiguration['identity']> = {}): TenantConfiguration {
  return {
    contractVersion: 1,
    storageVersion: 2,
    identity: {
      industry: null,
      businessType: null,
      businessModel: null,
      templateVersion: null,
      ...over,
    },
    regional: { country: null, timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' },
    modules: {
      conversations: true,
      contacts: true,
      opportunities: true,
      pipeline: true,
      catalog: true,
      quotes: false,
      tasks: false,
    },
    capabilities: {
      legacyDefaultsApplied: [],
      catalog: { allowedItemTypes: ['PRODUCT'], defaultItemType: 'PRODUCT' },
      definitions: [],
    },
    catalog: { categories: [], allowFreeText: true },
    pipeline: null,
    limits: {
      categories: { maxLength: 60, maxCount: 30 },
      regional: {
        country: { maxLength: 80 },
        timezone: { maxLength: 64 },
        currency: { length: 3 },
        locale: { maxLength: 35 },
      },
    },
  };
}

describe('tenant-configuration (reglas del cliente)', () => {
  it('businessModelFrom deriva igual que el servidor', () => {
    expect(businessModelFrom({ sellsProducts: true, sellsServices: false })).toBe('products');
    expect(businessModelFrom({ sellsProducts: false, sellsServices: true })).toBe('services');
    expect(businessModelFrom({ sellsProducts: true, sellsServices: true })).toBe('mixed');
    expect(businessModelFrom({ sellsProducts: false, sellsServices: false })).toBeNull();
  });

  it('suggestedItemType propone Servicio solo si la empresa vende exclusivamente servicios', () => {
    expect(suggestedItemType(config({ businessModel: 'services' }))).toBe('SERVICE');
    expect(suggestedItemType(config({ businessModel: 'mixed' }))).toBe('PRODUCT');
    expect(suggestedItemType(config({ businessModel: 'products' }))).toBe('PRODUCT');
    expect(suggestedItemType(config({ businessModel: null }))).toBe('PRODUCT');
    expect(suggestedItemType(undefined)).toBe('PRODUCT');
  });

  it('effectiveItemType: un producto anterior a la Fase 2 (sin tipo) es Producto', () => {
    expect(effectiveItemType(undefined)).toBe('PRODUCT');
    expect(effectiveItemType(null)).toBe('PRODUCT');
    expect(effectiveItemType('SERVICE')).toBe('SERVICE');
  });

  describe('validateRegionalDraft', () => {
    const ok = { country: 'Colombia', timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' };

    it('acepta valores válidos', () => {
      expect(validateRegionalDraft(ok)).toEqual({});
      expect(validateRegionalDraft({ ...ok, currency: 'crc', locale: 'es-cr', timezone: 'America/Costa_Rica' })).toEqual({});
      expect(validateRegionalDraft({ ...ok, country: '' })).toEqual({});
    });

    it('marca cada campo inválido junto a su campo, sin enviar nada', () => {
      const errors = validateRegionalDraft({
        country: 'x'.repeat(81),
        timezone: 'Bogota',
        currency: 'PESOS',
        locale: 'castellano',
      });
      expect(errors.country).toMatch(/80/);
      expect(errors.timezone).toMatch(/IANA/);
      expect(errors.currency).toMatch(/tres letras/);
      expect(errors.locale).toMatch(/idioma/);
    });

    it('rechaza una zona con forma válida pero desconocida y una moneda inventada', () => {
      const errors = validateRegionalDraft({ ...ok, timezone: 'America/Ciudad_Inventada', currency: 'ZZZ' });
      expect(errors.timezone).toBeDefined();
      expect(errors.currency).toBeDefined();
    });

    it('la zona vacía tiene su propio mensaje', () => {
      expect(validateRegionalDraft({ ...ok, timezone: '' }).timezone).toBe('Indica la zona horaria.');
    });
  });

  it('normalizeRegionalDraft recorta, pone la moneda en mayúsculas y canonicaliza el idioma', () => {
    expect(
      normalizeRegionalDraft({ country: '  Costa   Rica ', timezone: ' America/Costa_Rica ', currency: 'crc', locale: 'es-cr' }),
    ).toEqual({ country: 'Costa Rica', timezone: 'America/Costa_Rica', currency: 'CRC', locale: 'es-CR' });
  });
});
