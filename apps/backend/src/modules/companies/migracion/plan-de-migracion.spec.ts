import {
  igualdadProfunda,
  planificarEmpresa,
  type EntradaDeEmpresa,
} from './plan-de-migracion';
import { buildCompanySettingsV2 } from '../company-settings';

const EMPRESA = {
  country: 'Colombia',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  businessType: null,
};

const PIPELINE = {
  id: 'pipe-1',
  name: 'Ventas',
  stages: [
    {
      id: 's1',
      name: 'Nuevo',
      type: 'OPEN' as const,
      isInitial: true,
      order: 1,
    },
    {
      id: 's2',
      name: 'Ganado',
      type: 'WON' as const,
      isInitial: false,
      order: 2,
    },
    {
      id: 's3',
      name: 'Perdido',
      type: 'LOST' as const,
      isInitial: false,
      order: 3,
    },
  ],
};

function entrada(
  settingsCrudos: unknown,
  volumen: Partial<EntradaDeEmpresa['volumen']> = {},
): EntradaDeEmpresa {
  return {
    id: 'company-de-prueba',
    settingsCrudos,
    company: EMPRESA,
    pipeline: PIPELINE,
    volumen: {
      productos: volumen.productos ?? 0,
      cotizaciones: volumen.cotizaciones ?? 0,
      tareas: volumen.tareas ?? 0,
    },
  };
}

describe('igualdadProfunda', () => {
  it('compara por estructura, no por orden de las claves', () => {
    expect(igualdadProfunda({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(igualdadProfunda([1, 2], [2, 1])).toBe(false);
    expect(igualdadProfunda({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(igualdadProfunda(null, {})).toBe(false);
  });
});

describe('planificarEmpresa — empresas sin configuración (v0)', () => {
  it('canonicaliza conservando los módulos que hoy están activos por compatibilidad', () => {
    const plan = planificarEmpresa(entrada(null));

    expect(plan.decision).toBe('CANONICALIZAR');
    expect(plan.motivos).toEqual([]);
    expect(plan.storedVersionAntes).toBe(0);
    expect(plan.storedVersionDespues).toBe(2);
    // La única diferencia observable: dejan de ser activos «por compatibilidad»
    // y pasan a estar declarados, con el mismo resultado.
    expect(plan.legacyAntes.sort()).toEqual(['catalog', 'quotes', 'tasks']);
    expect(plan.legacyDespues).toEqual([]);
    expect(plan.canonico?.commercial).toEqual({
      sellsProducts: false,
      sellsServices: false,
      usesCatalog: true,
      usesQuotes: true,
      usesTasks: true,
    });
  });

  it('no inventa modelo de venta: el canónico deja las dos banderas comerciales en falso', () => {
    const plan = planificarEmpresa(entrada(undefined));

    expect(plan.canonico?.commercial.sellsProducts).toBe(false);
    expect(plan.canonico?.commercial.sellsServices).toBe(false);
  });

  it('declara las cinco banderas: tras migrar no queda nada por defecto', () => {
    const plan = planificarEmpresa(entrada(null));

    expect(Object.keys(plan.canonico!.commercial).sort()).toEqual([
      'sellsProducts',
      'sellsServices',
      'usesCatalog',
      'usesQuotes',
      'usesTasks',
    ]);
    expect(plan.canonico?.version).toBe(2);
    expect(plan.canonico?.catalog).toEqual({
      categories: [],
      allowFreeText: true,
    });
  });
});

describe('planificarEmpresa — configuración plana (v1)', () => {
  it('respeta tal cual las banderas que la empresa declaró', () => {
    const plan = planificarEmpresa(
      entrada({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: false,
        usesTasks: true,
        categories: ['Ropa', 'Calzado'],
      }),
    );

    expect(plan.decision).toBe('CANONICALIZAR');
    expect(plan.canonico?.commercial).toEqual({
      sellsProducts: true,
      sellsServices: false,
      usesCatalog: true,
      usesQuotes: false,
      usesTasks: true,
    });
    expect(plan.canonico?.catalog.categories).toEqual(['Ropa', 'Calzado']);
    expect(plan.legacyAntes).toEqual([]);
  });

  it('una bandera ausente se declara ACTIVA, que es como se lee hoy', () => {
    const plan = planificarEmpresa(
      entrada({ sellsProducts: true, usesCatalog: true, usesQuotes: false }),
    );

    // `usesTasks` no estaba declarada: hoy se lee activa por compatibilidad y
    // así queda escrita. Lo declarado manda sobre el default.
    expect(plan.canonico?.commercial.usesTasks).toBe(true);
    expect(plan.canonico?.commercial.usesQuotes).toBe(false);
    expect(plan.legacyAntes).toEqual(['tasks']);
    expect(plan.legacyDespues).toEqual([]);
  });

  it('conserva las claves que no pertenecen al contrato', () => {
    const plan = planificarEmpresa(
      entrada({
        sellsProducts: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        sellsServices: false,
        integracionPropia: { activa: true, nivel: 3 },
      }),
    );

    expect(plan.decision).toBe('CANONICALIZAR');
    expect(
      (plan.canonico as Record<string, unknown>).integracionPropia,
    ).toEqual({ activa: true, nivel: 3 });
  });

  it('una empresa que apagó su catálogo conservando elementos NO se considera ambigua', () => {
    // Apagar un módulo sin borrar datos es legítimo desde la Fase 4: la
    // migración no debe bloquear a quien lo hizo a conciencia.
    const plan = planificarEmpresa(
      entrada(
        {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: false,
          usesQuotes: true,
          usesTasks: true,
        },
        { productos: 12 },
      ),
    );

    expect(plan.decision).toBe('CANONICALIZAR');
    expect(plan.canonico?.commercial.usesCatalog).toBe(false);
  });
});

describe('planificarEmpresa — idempotencia', () => {
  it('una empresa ya canónica no se reescribe', () => {
    const canonico = buildCompanySettingsV2({
      commercial: {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
      },
      categories: ['Ropa'],
      vertical: null,
      pipelineDefaults: null,
    });

    const plan = planificarEmpresa(entrada(canonico));

    expect(plan.decision).toBe('SIN_CAMBIOS');
    expect(plan.canonico).toBeNull();
  });

  it('el orden de las claves no provoca una reescritura', () => {
    const canonico = buildCompanySettingsV2({
      commercial: {
        sellsProducts: false,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
      },
      categories: [],
      vertical: null,
      pipelineDefaults: null,
    });
    const reordenado = {
      catalog: canonico.catalog,
      commercial: {
        usesTasks: true,
        usesQuotes: true,
        usesCatalog: true,
        sellsServices: true,
        sellsProducts: false,
      },
      version: 2,
    };

    expect(planificarEmpresa(entrada(reordenado)).decision).toBe('SIN_CAMBIOS');
  });

  it('conserva vertical y ajustes de pipeline en una v2 completa', () => {
    const canonico = buildCompanySettingsV2({
      commercial: {
        sellsProducts: true,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
      },
      categories: ['Menú'],
      vertical: {
        industry: 'restaurante',
        businessType: 'Restaurante',
        businessModel: 'mixed',
        templateVersion: 1,
      },
      pipelineDefaults: { templateKey: 'restaurante', stagesTyped: true },
    });

    expect(planificarEmpresa(entrada(canonico)).decision).toBe('SIN_CAMBIOS');
  });
});

describe('planificarEmpresa — ambigüedades que detienen la migración', () => {
  it('una clave desconocida que chocaría con el contrato no se pisa', () => {
    const plan = planificarEmpresa(
      entrada({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        version: 'uno',
      }),
    );

    expect(plan.decision).toBe('AMBIGUA');
    expect(plan.motivos.join(' ')).toContain('version');
    expect(plan.canonico).toBeNull();
  });

  it('sub-claves de catálogo que el canónico no conserva', () => {
    const plan = planificarEmpresa(
      entrada({
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: { categories: [], allowFreeText: true, orden: 'alfabetico' },
      }),
    );

    expect(plan.decision).toBe('AMBIGUA');
    expect(plan.motivos.join(' ')).toContain('orden');
  });

  it('un vertical con forma inválida no se borra en silencio', () => {
    const plan = planificarEmpresa(
      entrada({
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: { categories: [], allowFreeText: true },
        vertical: { industry: 7 },
      }),
    );

    expect(plan.decision).toBe('AMBIGUA');
    expect(plan.motivos.join(' ')).toContain('vertical');
  });

  it('unos ajustes de pipeline con forma inválida tampoco', () => {
    const plan = planificarEmpresa(
      entrada({
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: { categories: [], allowFreeText: true },
        pipelineDefaults: { templateKey: 5, stagesTyped: 'si' },
      }),
    );

    expect(plan.decision).toBe('AMBIGUA');
    expect(plan.motivos.join(' ')).toContain('pipeline');
  });

  it('categorías que la normalización cambiaría se revisan a mano', () => {
    const plan = planificarEmpresa(
      entrada({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        categories: ['Ropa', 'ropa', '   '],
      }),
    );

    expect(plan.decision).toBe('AMBIGUA');
    expect(plan.motivos.join(' ')).toContain('categorías');
    expect(plan.canonico).toBeNull();
  });

  it('una ambigua conserva su versión de almacenamiento en el plan', () => {
    const plan = planificarEmpresa(
      entrada({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        categories: ['A', 'a'],
      }),
    );

    expect(plan.storedVersionAntes).toBe(1);
    expect(plan.storedVersionDespues).toBe(1);
  });
});

describe('planificarEmpresa — equivalencia observable', () => {
  it('la región, la identidad y el pipeline no cambian al canonicalizar', () => {
    const plan = planificarEmpresa(
      entrada({
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: { categories: ['Ropa'], allowFreeText: true },
        vertical: {
          industry: 'moda',
          businessType: 'Tienda',
          businessModel: 'products',
          templateVersion: 2,
        },
      }),
    );

    // Ya es canónica: la prueba de equivalencia interna pasó y no hay reescritura.
    expect(plan.decision).toBe('SIN_CAMBIOS');
    expect(plan.motivos).toEqual([]);
  });

  it('una configuración que no es un objeto se trata como ausencia, no como error', () => {
    for (const basura of ['texto', 42, [], true]) {
      const plan = planificarEmpresa(entrada(basura));
      expect(plan.decision).toBe('CANONICALIZAR');
      expect(plan.storedVersionAntes).toBe(0);
    }
  });
});
