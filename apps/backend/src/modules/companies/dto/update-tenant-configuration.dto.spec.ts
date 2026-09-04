import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { UpdateTenantConfigurationDto } from './update-tenant-configuration.dto';

// Same configuration as the global ValidationPipe registered in src/main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const transform = (body: unknown) =>
  pipe.transform(body, {
    type: 'body',
    metatype: UpdateTenantConfigurationDto,
    data: undefined,
  });

async function messagesOf(body: unknown): Promise<string[]> {
  try {
    await transform(body);
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message;
  }
  return [];
}

/**
 * La lista blanca del PATCH de configuración, con el ValidationPipe real.
 * Todo lo que no es editable se rechaza con 400 antes de llegar al servicio.
 */
describe('UpdateTenantConfigurationDto (ValidationPipe real)', () => {
  it('acepta un parche completo con solo campos editables', async () => {
    const dto = await transform({
      regional: {
        country: 'Colombia',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
      },
      commercial: { sellsProducts: true, sellsServices: true },
      modules: { catalog: true, quotes: false, tasks: true },
      catalog: { categories: ['Salas', 'Comedores'] },
    });
    expect(dto).toBeInstanceOf(UpdateTenantConfigurationDto);
  });

  it('acepta un parche parcial y country: null (limpiar)', async () => {
    await expect(
      transform({ regional: { country: null } }),
    ).resolves.toBeDefined();
    await expect(
      transform({ modules: { tasks: false } }),
    ).resolves.toBeDefined();
    await expect(transform({})).resolves.toBeDefined();
  });

  it.each([
    ['settings', { settings: { version: 2 } }],
    ['storageVersion', { storageVersion: 2 }],
    ['contractVersion', { contractVersion: 1 }],
    ['identity', { identity: { industry: 'furniture_decor' } }],
    ['pipeline', { pipeline: { id: 'x' } }],
    ['pipelineDefaults', { pipelineDefaults: { templateKey: 'x' } }],
    ['companyId', { companyId: 'company-b' }],
    ['id', { id: 'company-b' }],
    ['limits', { limits: {} }],
  ])('rechaza la clave de nivel superior %s con 400', async (key, body) => {
    const messages = await messagesOf(body);
    expect(
      messages.some((m) => m.includes(`property ${key} should not exist`)),
    ).toBe(true);
  });

  it('rechaza claves desconocidas anidadas', async () => {
    expect(
      (
        await messagesOf({ regional: { timezone: 'UTC', city: 'Bogotá' } })
      ).join(' '),
    ).toMatch(/city should not exist/);
    expect(
      (await messagesOf({ commercial: { usesCatalog: true } })).join(' '),
    ).toMatch(/usesCatalog should not exist/);
    expect(
      (await messagesOf({ modules: { conversations: false } })).join(' '),
    ).toMatch(/conversations should not exist/);
    expect(
      (
        await messagesOf({ catalog: { categories: [], allowFreeText: false } })
      ).join(' '),
    ).toMatch(/allowFreeText should not exist/);
  });

  it('timezone, currency y locale no pueden ser null ni de otro tipo', async () => {
    expect(
      (await messagesOf({ regional: { timezone: null } })).length,
    ).toBeGreaterThan(0);
    expect(
      (await messagesOf({ regional: { currency: 123 } })).length,
    ).toBeGreaterThan(0);
    expect(
      (await messagesOf({ regional: { locale: null } })).length,
    ).toBeGreaterThan(0);
  });

  it('acota la forma: moneda de más de tres letras y categorías fuera de límite', async () => {
    expect(
      (await messagesOf({ regional: { currency: 'PESOS' } })).length,
    ).toBeGreaterThan(0);
    expect(
      (await messagesOf({ catalog: { categories: ['x'.repeat(61)] } })).join(
        ' ',
      ),
    ).toMatch(/60 caracteres/);
    expect(
      (
        await messagesOf({
          catalog: {
            categories: Array.from({ length: 31 }, (_, i) => `c${i}`),
          },
        })
      ).join(' '),
    ).toMatch(/Máximo 30/);
  });

  it('las banderas deben ser booleanas', async () => {
    expect(
      (await messagesOf({ commercial: { sellsProducts: 'sí' } })).length,
    ).toBeGreaterThan(0);
    expect(
      (await messagesOf({ modules: { catalog: 1 } })).length,
    ).toBeGreaterThan(0);
  });
});
