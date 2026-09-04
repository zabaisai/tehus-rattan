import { BadRequestException } from '@nestjs/common';
import { parseCompanySettings } from './company-settings';
import {
  buildTenantConfiguration,
  deriveBusinessModel,
  deriveModules,
  effectiveCatalogItemType,
  normalizeCountry,
  normalizeCurrency,
  normalizeLocale,
  normalizeRegionalPatch,
  normalizeTimezone,
  readRegional,
  REGIONAL_DEFAULTS,
} from './tenant-configuration';

const ROW = {
  country: 'Colombia',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  businessType: null,
};

describe('TenantConfigurationV1 — reglas puras', () => {
  describe('deriveBusinessModel', () => {
    it.each([
      [true, false, 'products'],
      [false, true, 'services'],
      [true, true, 'mixed'],
      [false, false, null],
    ])(
      'sellsProducts=%s sellsServices=%s → %s',
      (sellsProducts, sellsServices, expected) => {
        expect(deriveBusinessModel({ sellsProducts, sellsServices })).toBe(
          expected,
        );
      },
    );
  });

  describe('deriveModules', () => {
    it('los centrales son siempre true y los opcionales salen de las banderas declaradas', () => {
      const modules = deriveModules({
        declaredFlags: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: false,
          usesQuotes: true,
          usesTasks: false,
        },
      });
      expect(modules).toEqual({
        conversations: true,
        contacts: true,
        opportunities: true,
        pipeline: true,
        catalog: false,
        quotes: true,
        tasks: false,
      });
    });
  });

  describe('normalizeTimezone', () => {
    it.each(['America/Bogota', 'America/Costa_Rica', 'Europe/Madrid', 'UTC'])(
      'acepta %s',
      (tz) => {
        expect(normalizeTimezone(tz)).toBe(tz);
      },
    );

    it('canonicaliza mayúsculas y recorta espacios', () => {
      expect(normalizeTimezone(' america/bogota ')).toBe('America/Bogota');
    });

    it.each([
      'Bogota',
      'America/Ciudad_Inventada',
      '+05:00',
      'GMT-5',
      '',
      'America/Bogota; DROP TABLE',
      'x'.repeat(70),
    ])('rechaza «%s» con 400', (tz) => {
      expect(() => normalizeTimezone(tz)).toThrow(BadRequestException);
    });

    it('rechaza lo que no es texto', () => {
      expect(() => normalizeTimezone(5)).toThrow(BadRequestException);
      expect(() => normalizeTimezone(null)).toThrow(BadRequestException);
    });
  });

  describe('normalizeCurrency', () => {
    it.each([
      ['COP', 'COP'],
      ['usd', 'USD'],
      [' crc ', 'CRC'],
      ['Eur', 'EUR'],
    ])('%s → %s', (input, expected) => {
      expect(normalizeCurrency(input)).toBe(expected);
    });

    it.each(['CO', 'COPS', 'C0P', 'ZZZ', '$', '', 'pesos'])(
      'rechaza «%s» con 400',
      (input) => {
        expect(() => normalizeCurrency(input)).toThrow(BadRequestException);
      },
    );
  });

  describe('normalizeLocale', () => {
    it.each([
      ['es-CO', 'es-CO'],
      ['es-co', 'es-CO'],
      ['ES-cr', 'es-CR'],
      ['en-us', 'en-US'],
      ['pt-BR', 'pt-BR'],
      ['es', 'es'],
    ])('%s → %s', (input, expected) => {
      expect(normalizeLocale(input)).toBe(expected);
    });

    it.each([
      '',
      'español',
      'es_CO',
      'e',
      '123',
      'es-',
      'x-private',
      'a'.repeat(40),
    ])('rechaza «%s» con 400', (input) => {
      expect(() => normalizeLocale(input)).toThrow(BadRequestException);
    });
  });

  describe('normalizeCountry', () => {
    it('colapsa espacios y recorta', () => {
      expect(normalizeCountry('  Costa   Rica ')).toBe('Costa Rica');
    });
    it('vacío o null limpian el campo', () => {
      expect(normalizeCountry('')).toBeNull();
      expect(normalizeCountry('   ')).toBeNull();
      expect(normalizeCountry(null)).toBeNull();
      expect(normalizeCountry(undefined)).toBeNull();
    });
    it('aplica un límite razonable', () => {
      expect(() => normalizeCountry('x'.repeat(81))).toThrow(
        BadRequestException,
      );
      expect(normalizeCountry('x'.repeat(80))).toHaveLength(80);
    });
    it('rechaza lo que no es texto', () => {
      expect(() => normalizeCountry(42)).toThrow(BadRequestException);
    });
  });

  describe('normalizeRegionalPatch', () => {
    it('solo toca lo presente y normaliza cada campo', () => {
      expect(
        normalizeRegionalPatch({
          timezone: 'america/costa_rica',
          currency: 'crc',
        }),
      ).toEqual({ timezone: 'America/Costa_Rica', currency: 'CRC' });
      expect(normalizeRegionalPatch(undefined)).toEqual({});
      expect(normalizeRegionalPatch({})).toEqual({});
    });

    it('un campo inválido tumba TODO el parche antes de escribir', () => {
      expect(() =>
        normalizeRegionalPatch({
          timezone: 'America/Bogota',
          currency: 'PESOS',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('readRegional', () => {
    it('devuelve las columnas tal cual cuando son válidas', () => {
      expect(readRegional(ROW)).toEqual({
        country: 'Colombia',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
      });
    });

    it('una columna con texto inválido histórico cae al default del producto sin lanzar', () => {
      expect(
        readRegional({
          country: '   ',
          timezone: 'Zona/Inventada',
          currency: 'pesos',
          locale: 'castellano',
          businessType: null,
        }),
      ).toEqual({
        country: null,
        timezone: REGIONAL_DEFAULTS.timezone,
        currency: REGIONAL_DEFAULTS.currency,
        locale: REGIONAL_DEFAULTS.locale,
      });
    });

    it('columnas nulas (no debería pasar, pero no rompe) → defaults', () => {
      expect(
        readRegional({
          country: null,
          timezone: null,
          currency: null,
          locale: null,
          businessType: null,
        }),
      ).toMatchObject(REGIONAL_DEFAULTS);
    });
  });

  describe('buildTenantConfiguration', () => {
    const pipeline = {
      id: 'p1',
      name: 'Ventas',
      stages: [
        {
          id: 's1',
          name: 'Nuevo',
          type: 'OPEN' as const,
          isInitial: true,
          order: 0,
        },
        {
          id: 's2',
          name: 'Ganado',
          type: 'WON' as const,
          isInitial: false,
          order: 1,
        },
        {
          id: 's3',
          name: 'Perdido',
          type: 'LOST' as const,
          isInitial: false,
          order: 2,
        },
      ],
    };

    it('v0 (sin settings): identidad nula, modelo nulo, módulos opcionales activos por compatibilidad, storageVersion 0', () => {
      const config = buildTenantConfiguration({
        company: ROW,
        settings: parseCompanySettings(null),
        pipeline: null,
      });
      expect(config.contractVersion).toBe(1);
      expect(config.storageVersion).toBe(0);
      expect(config.identity).toEqual({
        industry: null,
        businessType: null,
        businessModel: null,
        templateVersion: null,
      });
      // Fase 4: los opcionales no declarados quedan ACTIVOS por compatibilidad.
      expect(config.modules).toMatchObject({
        conversations: true,
        contacts: true,
        opportunities: true,
        pipeline: true,
        catalog: true,
        quotes: true,
        tasks: true,
      });
      expect(config.capabilities.legacyDefaultsApplied).toEqual([
        'catalog',
        'quotes',
        'tasks',
      ]);
      expect(config.capabilities.definitions).toHaveLength(7);
      expect(config.catalog).toEqual({ categories: [], allowFreeText: true });
      expect(config.pipeline).toBeNull();
      expect(config.limits.categories).toEqual({ maxLength: 60, maxCount: 30 });
      expect(config.limits.regional.country.maxLength).toBe(80);
    });

    it('v1: banderas planas → modelo derivado, categorías, storageVersion 1; el tipo de negocio manual viene de la columna', () => {
      const config = buildTenantConfiguration({
        company: { ...ROW, businessType: '  Tienda de muebles ' },
        settings: parseCompanySettings({
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: false,
          usesTasks: true,
          categories: ['Salas', 'Comedores'],
          futuro: { conservar: true },
        }),
        pipeline,
      });
      expect(config.storageVersion).toBe(1);
      expect(config.identity).toEqual({
        industry: null,
        businessType: 'Tienda de muebles',
        businessModel: 'products',
        templateVersion: null,
      });
      expect(config.modules.catalog).toBe(true);
      expect(config.modules.quotes).toBe(false);
      expect(config.catalog.categories).toEqual(['Salas', 'Comedores']);
      expect(config.pipeline).toEqual(pipeline);
      // Las claves desconocidas nunca salen al contrato.
      expect(JSON.stringify(config)).not.toContain('futuro');
    });

    it('v2: la industria y la versión de plantilla salen del vertical; el modelo se deriva de las banderas, no de la plantilla', () => {
      const config = buildTenantConfiguration({
        company: ROW,
        settings: parseCompanySettings({
          version: 2,
          commercial: {
            sellsProducts: true,
            sellsServices: true,
            usesCatalog: true,
            usesQuotes: true,
            usesTasks: true,
          },
          catalog: { categories: ['Consultas'], allowFreeText: true },
          vertical: {
            industry: 'veterinary',
            businessType: 'clinic',
            businessModel: 'services',
            templateVersion: 2,
          },
          pipelineDefaults: { templateKey: 'clinic', stagesTyped: true },
        }),
        pipeline,
      });
      expect(config.storageVersion).toBe(2);
      expect(config.identity).toEqual({
        industry: 'veterinary',
        businessType: 'clinic',
        businessModel: 'mixed',
        templateVersion: 2,
      });
      expect(config.pipeline?.stages.map((s) => s.type)).toEqual([
        'OPEN',
        'WON',
        'LOST',
      ]);
    });

    it('no comparte referencias con la vista normalizada (categorías copiadas)', () => {
      const settings = parseCompanySettings({ categories: ['A'] });
      const config = buildTenantConfiguration({
        company: ROW,
        settings,
        pipeline: null,
      });
      config.catalog.categories.push('B');
      expect(settings.catalog.categories).toEqual(['A']);
    });
  });

  describe('effectiveCatalogItemType', () => {
    it('NULL o ausente → PRODUCT; explícito se respeta', () => {
      expect(effectiveCatalogItemType(null)).toBe('PRODUCT');
      expect(effectiveCatalogItemType(undefined)).toBe('PRODUCT');
      expect(effectiveCatalogItemType('SERVICE')).toBe('SERVICE');
    });
  });
});
