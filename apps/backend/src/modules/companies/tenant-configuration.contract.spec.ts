import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import { parseCompanySettings } from './company-settings';
import { buildTenantConfiguration } from './tenant-configuration';

/**
 * El contrato publicado (`docs/contracts/tenant-configuration.v1.schema.json`)
 * y la respuesta real del motor son el MISMO dato: si alguien cambia la forma
 * de la respuesta sin tocar el documento —o al revés—, esta prueba falla.
 */
describe('TenantConfigurationV1 — contrato publicado', () => {
  const schemaPath = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'docs',
    'contracts',
    'tenant-configuration.v1.schema.json',
  );
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  const company = {
    country: 'Colombia',
    timezone: 'America/Bogota',
    currency: 'COP',
    locale: 'es-CO',
    businessType: null,
  };

  const pipeline = {
    id: 'clx000000000000000000001',
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

  it('el esquema en sí es válido', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(schema['x-phase2'].status).toBe('IMPLEMENTED');
  });

  it.each([
    ['v0 sin settings y sin pipeline', null, null],
    [
      'v1 con pipeline',
      {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: false,
        usesTasks: true,
        categories: ['Salas', 'Comedores'],
        futuro: { conservar: true },
      },
      pipeline,
    ],
    [
      'v2 con plantilla',
      {
        version: 2,
        commercial: {
          sellsProducts: false,
          sellsServices: true,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: true,
        },
        catalog: { categories: ['Consultas', 'Vacunas'], allowFreeText: true },
        vertical: {
          industry: 'veterinary',
          businessType: 'clinic',
          businessModel: 'services',
          templateVersion: 2,
        },
        pipelineDefaults: { templateKey: 'clinic', stagesTyped: true },
      },
      pipeline,
    ],
  ])('la respuesta del motor cumple el esquema: %s', (_name, raw, pipe) => {
    const config = buildTenantConfiguration({
      company,
      settings: parseCompanySettings(raw),
      pipeline: pipe,
    });
    // Lo que viaja por HTTP es JSON: se valida la forma serializada.
    const ok = validate(JSON.parse(JSON.stringify(config)));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('el esquema rechaza lo que el contrato prohíbe (regresión del propio esquema)', () => {
    const base = JSON.parse(
      JSON.stringify(
        buildTenantConfiguration({
          company,
          settings: parseCompanySettings(null),
          pipeline: null,
        }),
      ),
    );
    expect(validate({ ...base, extra: 1 })).toBe(false);
    expect(validate({ ...base, contractVersion: 2 })).toBe(false);
    expect(
      validate({ ...base, regional: { ...base.regional, currency: 'cop' } }),
    ).toBe(false);
    expect(
      validate({ ...base, modules: { ...base.modules, conversations: false } }),
    ).toBe(false);
  });
});
