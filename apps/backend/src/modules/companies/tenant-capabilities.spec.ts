import { ForbiddenException } from '@nestjs/common';
import { parseCompanySettings } from './company-settings';
import {
  allowedItemTypesFor,
  CAPABILITY_KEYS,
  CAPABILITY_REGISTRY,
  capabilityDefinitions,
  defaultItemTypeFor,
  isTenantCapabilityKey,
  itemTypeNotAllowedMessage,
  MODULE_DISABLED_CODE,
  ModuleDisabledException,
  moduleDependencyViolation,
  OPTIONAL_CAPABILITIES,
  resolveEffectiveCapabilities,
  resolveEffectiveCommercial,
} from './tenant-capabilities';

/**
 * El registro es la única fuente de qué puede hacer una empresa. Aquí se
 * fija su forma y, sobre todo, la regla de compatibilidad: una empresa que
 * nunca declaró un módulo lo conserva; solo un `false` explícito desactiva.
 */
describe('tenant-capabilities (registro y resolución efectiva)', () => {
  describe('registro', () => {
    it('describe exactamente los siete módulos del producto', () => {
      expect(CAPABILITY_KEYS.sort()).toEqual(
        [
          'conversations',
          'contacts',
          'opportunities',
          'pipeline',
          'catalog',
          'quotes',
          'tasks',
        ].sort(),
      );
    });

    it('los centrales son fijos y los comerciales configurables con bandera', () => {
      for (const key of [
        'conversations',
        'contacts',
        'opportunities',
        'pipeline',
      ] as const) {
        const d = CAPABILITY_REGISTRY[key];
        expect(d.group).toBe('core');
        expect(d.alwaysOn).toBe(true);
        expect(d.configurable).toBe(false);
        expect(d.settingsFlag).toBeNull();
      }
      for (const key of OPTIONAL_CAPABILITIES) {
        const d = CAPABILITY_REGISTRY[key];
        expect(d.group).toBe('commercial');
        expect(d.alwaysOn).toBe(false);
        expect(d.configurable).toBe(true);
        expect(d.settingsFlag).toMatch(/^uses/);
        expect(d.legacyDefault).toBe(true);
      }
    });

    it('usa el vocabulario base y describe cada capacidad', () => {
      expect(CAPABILITY_REGISTRY.contacts.label).toBe('Contactos');
      expect(CAPABILITY_REGISTRY.pipeline.label).toBe('Pipeline');
      expect(CAPABILITY_REGISTRY.tasks.label).toBe('Tareas');
      expect(CAPABILITY_REGISTRY.catalog.label).toBe('Catálogo');
      for (const key of CAPABILITY_KEYS) {
        expect(CAPABILITY_REGISTRY[key].description.length).toBeGreaterThan(10);
      }
    });

    it('cotizaciones se relaciona con el catálogo sin exigirlo (las plantillas activan cotizaciones sin catálogo)', () => {
      expect(CAPABILITY_REGISTRY.quotes.relatedTo).toEqual(['catalog']);
      expect(CAPABILITY_REGISTRY.quotes.dependsOn).toEqual([]);
      expect(CAPABILITY_REGISTRY.catalog.dependsOn).toEqual([]);
      expect(CAPABILITY_REGISTRY.tasks.dependsOn).toEqual([]);
    });

    it('la vista pública no expone rutas ni banderas internas', () => {
      const views = capabilityDefinitions();
      expect(views).toHaveLength(7);
      for (const v of views) {
        expect(Object.keys(v).sort()).toEqual(
          [
            'key',
            'label',
            'description',
            'group',
            'alwaysOn',
            'configurable',
            'dependsOn',
            'relatedTo',
          ].sort(),
        );
      }
    });

    it('isTenantCapabilityKey rechaza claves desconocidas y prototipos', () => {
      expect(isTenantCapabilityKey('catalog')).toBe(true);
      expect(isTenantCapabilityKey('billing')).toBe(false);
      expect(isTenantCapabilityKey('toString')).toBe(false);
      expect(isTenantCapabilityKey(null)).toBe(false);
    });
  });

  describe('resolución efectiva', () => {
    it('v0 (sin settings): los opcionales quedan activos por compatibilidad', () => {
      const caps = resolveEffectiveCapabilities(parseCompanySettings(null));
      expect(caps.modules).toEqual({
        conversations: true,
        contacts: true,
        opportunities: true,
        pipeline: true,
        catalog: true,
        quotes: true,
        tasks: true,
      });
      expect(caps.legacyDefaultsApplied).toEqual([
        'catalog',
        'quotes',
        'tasks',
      ]);
      expect(caps.catalog).toEqual({
        allowedItemTypes: ['PRODUCT', 'SERVICE'],
        defaultItemType: 'PRODUCT',
      });
    });

    it('v1 con todas las banderas declaradas se respeta tal cual', () => {
      const caps = resolveEffectiveCapabilities(
        parseCompanySettings({
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: false,
          usesTasks: true,
          categories: ['A'],
        }),
      );
      expect(caps.modules).toMatchObject({
        catalog: true,
        quotes: false,
        tasks: true,
      });
      expect(caps.legacyDefaultsApplied).toEqual([]);
      expect(caps.catalog).toEqual({
        allowedItemTypes: ['PRODUCT'],
        defaultItemType: 'PRODUCT',
      });
    });

    it('v1 con una bandera ausente: esa queda activa, las declaradas mandan', () => {
      const caps = resolveEffectiveCapabilities(
        parseCompanySettings({ usesCatalog: false, usesTasks: true }),
      );
      expect(caps.modules).toMatchObject({
        catalog: false,
        quotes: true,
        tasks: true,
      });
      expect(caps.legacyDefaultsApplied).toEqual(['quotes']);
    });

    it('v2 escrita por el motor declara todo: sin defaults de compatibilidad', () => {
      const caps = resolveEffectiveCapabilities(
        parseCompanySettings({
          version: 2,
          commercial: {
            sellsProducts: false,
            sellsServices: true,
            usesCatalog: true,
            usesQuotes: true,
            usesTasks: false,
          },
          catalog: { categories: [], allowFreeText: true },
        }),
      );
      expect(caps.modules).toMatchObject({
        catalog: true,
        quotes: true,
        tasks: false,
      });
      expect(caps.legacyDefaultsApplied).toEqual([]);
      expect(caps.catalog).toEqual({
        allowedItemTypes: ['SERVICE'],
        defaultItemType: 'SERVICE',
      });
    });

    it('un false explícito desactiva aunque el JSON sea antiguo', () => {
      const caps = resolveEffectiveCapabilities(
        parseCompanySettings({ usesQuotes: false }),
      );
      expect(caps.modules.quotes).toBe(false);
    });

    it('las banderas comerciales efectivas no inventan el modelo de venta', () => {
      const flags = resolveEffectiveCommercial(parseCompanySettings(null));
      expect(flags).toEqual({
        sellsProducts: false,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
      });
    });
  });

  describe('tipo de elemento permitido por modelo comercial', () => {
    it.each([
      ['products', ['PRODUCT'], 'PRODUCT'],
      ['services', ['SERVICE'], 'SERVICE'],
      ['mixed', ['PRODUCT', 'SERVICE'], 'PRODUCT'],
      [null, ['PRODUCT', 'SERVICE'], 'PRODUCT'],
    ] as const)('%s → permitidos %j, default %s', (model, allowed, def) => {
      expect(allowedItemTypesFor(model)).toEqual(allowed);
      expect(defaultItemTypeFor(model)).toBe(def);
    });

    it('explica el rechazo en español según el modelo', () => {
      expect(itemTypeNotAllowedMessage('PRODUCT', ['SERVICE'])).toMatch(
        /solo servicios/,
      );
      expect(itemTypeNotAllowedMessage('SERVICE', ['PRODUCT'])).toMatch(
        /solo productos/,
      );
    });
  });

  describe('dependencias y error estable', () => {
    it('hoy no hay dependencias duras: cotizaciones sin catálogo es válido', () => {
      expect(
        moduleDependencyViolation({
          catalog: false,
          quotes: true,
          tasks: true,
        }),
      ).toBeNull();
    });

    it('ModuleDisabledException es un 403 con código y módulo, sin datos de la empresa', () => {
      const e = new ModuleDisabledException('catalog');
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse()).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        code: MODULE_DISABLED_CODE,
        module: 'catalog',
        message: 'El módulo Catálogo no está activo para tu empresa',
      });
    });
  });
});
