import { BadRequestException } from '@nestjs/common';
import {
  buildCompanySettingsV2,
  CATEGORY_LIMITS,
  normalizeCategories,
  parseCompanySettings,
  STAGE_LIMITS,
  toPublicSettings,
  validateTypedStages,
} from './company-settings';

describe('Company.settings — parser central', () => {
  describe('parseCompanySettings', () => {
    it('null / undefined / no-objeto → versión 0 con valores neutros', () => {
      for (const raw of [null, undefined, 'texto', 3, ['a']]) {
        const parsed = parseCompanySettings(raw);
        expect(parsed.storedVersion).toBe(0);
        expect(parsed.commercial).toEqual({
          sellsProducts: false,
          sellsServices: false,
          usesCatalog: false,
          usesQuotes: false,
          usesTasks: false,
        });
        expect(parsed.catalog.categories).toEqual([]);
        expect(parsed.vertical).toBeNull();
      }
    });

    it('lee la forma v1 de las empresas existentes sin modificarla', () => {
      // Forma exacta que escribía el onboarding hasta la Fase 0 (Tehus).
      const v1 = {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: false,
        usesTasks: true,
        categories: ['Salas', 'Comedores'],
      };
      const parsed = parseCompanySettings(v1);
      expect(parsed.storedVersion).toBe(1);
      expect(parsed.commercial).toEqual({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: false,
        usesTasks: true,
      });
      expect(parsed.catalog.categories).toEqual(['Salas', 'Comedores']);
      expect(parsed.vertical).toBeNull();
      expect(parsed.extra).toEqual({});
      // No muta la entrada.
      expect(v1.categories).toEqual(['Salas', 'Comedores']);
    });

    it('conserva claves desconocidas en v1 y en v2', () => {
      const v1 = parseCompanySettings({
        sellsProducts: true,
        futuro: { a: 1 },
      });
      expect(v1.storedVersion).toBe(1);
      expect(v1.extra).toEqual({ futuro: { a: 1 } });

      const v2 = parseCompanySettings({
        version: 2,
        commercial: { usesCatalog: true },
        catalog: { categories: ['Productos'] },
        futuro: 'x',
      });
      expect(v2.storedVersion).toBe(2);
      expect(v2.extra).toEqual({ futuro: 'x' });
      expect(v2.commercial.usesCatalog).toBe(true);
      expect(v2.commercial.sellsProducts).toBe(false);
      expect(v2.catalog.categories).toEqual(['Productos']);
    });

    it('lee v2 completa con vertical y pipelineDefaults', () => {
      const parsed = parseCompanySettings({
        version: 2,
        commercial: {
          sellsProducts: false,
          sellsServices: true,
          usesCatalog: false,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: { categories: [], allowFreeText: true },
        vertical: {
          industry: 'professional_services',
          businessType: 'consulting',
          businessModel: 'services',
          templateVersion: 2,
        },
        pipelineDefaults: { templateKey: 'consulting', stagesTyped: true },
      });
      expect(parsed.vertical).toEqual({
        industry: 'professional_services',
        businessType: 'consulting',
        businessModel: 'services',
        templateVersion: 2,
      });
      expect(parsed.pipelineDefaults).toEqual({
        templateKey: 'consulting',
        stagesTyped: true,
      });
    });

    it('ignora un vertical malformado sin romper la lectura', () => {
      const parsed = parseCompanySettings({
        version: 2,
        commercial: {},
        catalog: { categories: ['A'] },
        vertical: { industry: 'x', businessModel: 'raro' },
      });
      expect(parsed.vertical).toBeNull();
      expect(parsed.catalog.categories).toEqual(['A']);
    });
  });

  describe('normalizeCategories', () => {
    it('recorta, quita vacíos y duplicados sin distinguir mayúsculas, conserva orden y grafía', () => {
      expect(
        normalizeCategories([
          '  Salas ',
          'salas',
          '',
          'SALAS',
          'Comedores  ',
          'Come dores',
        ]),
      ).toEqual(['Salas', 'Comedores', 'Come dores']);
    });

    it('en modo estricto rechaza lo que en modo laxo descarta', () => {
      expect(normalizeCategories('no-lista')).toEqual([]);
      expect(() => normalizeCategories('no-lista', { strict: true })).toThrow(
        BadRequestException,
      );
      const larga = 'x'.repeat(CATEGORY_LIMITS.maxLength + 1);
      expect(normalizeCategories([larga])).toEqual([]);
      expect(() => normalizeCategories([larga], { strict: true })).toThrow(
        BadRequestException,
      );
      const muchas = Array.from(
        { length: CATEGORY_LIMITS.maxCount + 1 },
        (_, i) => `c${i}`,
      );
      expect(normalizeCategories(muchas)).toHaveLength(
        CATEGORY_LIMITS.maxCount,
      );
      expect(() => normalizeCategories(muchas, { strict: true })).toThrow(
        BadRequestException,
      );
      expect(() => normalizeCategories([1], { strict: true })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildCompanySettingsV2', () => {
    it('escribe v2 con categorías normalizadas y conserva extra', () => {
      const built = buildCompanySettingsV2({
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        categories: [' Vehículos', 'vehículos', 'Accesorios'],
        vertical: {
          industry: 'automotive',
          businessType: 'dealership',
          businessModel: 'products',
          templateVersion: 2,
        },
        pipelineDefaults: { templateKey: 'dealership', stagesTyped: true },
        extra: { futuro: true },
      });
      expect(built).toEqual({
        futuro: true,
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: {
          categories: ['Vehículos', 'Accesorios'],
          allowFreeText: true,
        },
        vertical: {
          industry: 'automotive',
          businessType: 'dealership',
          businessModel: 'products',
          templateVersion: 2,
        },
        pipelineDefaults: { templateKey: 'dealership', stagesTyped: true },
      });
      // Lo que se escribe se vuelve a leer igual (ida y vuelta).
      const again = parseCompanySettings(built);
      expect(again.storedVersion).toBe(2);
      expect(again.catalog.categories).toEqual(['Vehículos', 'Accesorios']);
      expect(again.extra).toEqual({ futuro: true });
    });

    it('extra nunca pisa las claves del contrato', () => {
      const built = buildCompanySettingsV2({
        commercial: {
          sellsProducts: false,
          sellsServices: true,
          usesCatalog: false,
          usesQuotes: false,
          usesTasks: false,
        },
        categories: [],
        extra: { version: 99, catalog: 'basura' },
      });
      expect(built.version).toBe(2);
      expect(built.catalog).toEqual({ categories: [], allowFreeText: true });
    });
  });

  describe('toPublicSettings', () => {
    it('expone versión, banderas, catálogo y límites; nunca extra', () => {
      const pub = toPublicSettings(
        parseCompanySettings({
          sellsProducts: true,
          categories: ['A'],
          secreto: 'no',
        }),
      );
      expect(pub.version).toBe(1);
      expect(pub.catalog.categories).toEqual(['A']);
      expect(pub.limits.categories).toEqual(CATEGORY_LIMITS);
      expect(JSON.stringify(pub)).not.toContain('secreto');
    });
  });

  describe('validateTypedStages', () => {
    const ok = [
      { name: 'Nuevo lead', type: 'OPEN' as const },
      { name: 'Contactado', type: 'OPEN' as const },
      { name: 'Cerrado ganado', type: 'WON' as const },
      { name: 'Cerrado perdido', type: 'LOST' as const },
    ];

    it('acepta un pipeline con ≥1 OPEN, 1 WON y 1 LOST y recorta nombres', () => {
      expect(
        validateTypedStages([
          { name: '  Nuevo  lead ', type: 'OPEN' },
          ...ok.slice(2),
        ]),
      ).toEqual([
        { name: 'Nuevo lead', type: 'OPEN' },
        { name: 'Cerrado ganado', type: 'WON' },
        { name: 'Cerrado perdido', type: 'LOST' },
      ]);
    });

    it.each([
      ['vacío', []],
      ['sin OPEN', ok.slice(2)],
      ['dos WON', [...ok, { name: 'Ganado 2', type: 'WON' as const }]],
      ['sin LOST', ok.slice(0, 3)],
      ['nombre vacío', [{ name: '  ', type: 'OPEN' as const }, ...ok.slice(2)]],
      ['duplicado', [{ name: 'nuevo lead', type: 'OPEN' as const }, ...ok]],
      ['tipo inválido', [{ name: 'X', type: 'RARO' as any }, ...ok.slice(2)]],
      [
        'demasiado larga',
        [
          {
            name: 'x'.repeat(STAGE_LIMITS.maxNameLength + 1),
            type: 'OPEN' as const,
          },
          ...ok.slice(2),
        ],
      ],
      [
        'demasiadas',
        [
          ...Array.from({ length: STAGE_LIMITS.maxCount - 1 }, (_, i) => ({
            name: `E${i}`,
            type: 'OPEN' as const,
          })),
          ...ok.slice(2),
        ],
      ],
    ])('rechaza %s', (_label, stages) => {
      expect(() => validateTypedStages(stages as any)).toThrow(
        BadRequestException,
      );
    });
  });
});
