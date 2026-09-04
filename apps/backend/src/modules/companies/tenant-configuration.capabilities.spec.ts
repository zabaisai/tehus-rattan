import { NotFoundException } from '@nestjs/common';
import {
  CAPABILITIES_CACHE_TTL_MS,
  TenantConfigurationService,
} from './tenant-configuration.service';

/**
 * `resolveCapabilities` es lo que consulta el guard en cada petición: aquí se
 * fija que cachea por empresa, que la caché nunca cruza tenants, que expira y
 * que escribir la configuración la invalida. También que un PATCH de una
 * empresa legacy se fusiona sobre los módulos EFECTIVOS: desactivar uno no
 * apaga los otros dos.
 */
describe('TenantConfigurationService — capacidades (Fase 4)', () => {
  const ACTOR = { userId: 'user-1', role: 'ADMIN' as const };
  let rows: Record<string, any>;
  let prisma: any;
  let audit: any;
  let service: TenantConfigurationService;

  beforeEach(() => {
    rows = {
      'empresa-a': {
        country: null,
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
        businessType: null,
        settings: { usesCatalog: true, usesQuotes: false, usesTasks: true },
      },
      'empresa-b': {
        country: null,
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
        businessType: null,
        settings: null, // legacy v0
      },
    };
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: 'x' }]),
      company: {
        findUnique: jest.fn(async ({ where }: any) => rows[where.id] ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          rows[where.id] = { ...rows[where.id], ...data };
          return rows[where.id];
        }),
      },
      pipeline: { findFirst: jest.fn(async () => null) },
    };
    prisma = {
      company: {
        findUnique: jest.fn(async ({ where }: any) => rows[where.id] ?? null),
      },
      pipeline: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new TenantConfigurationService(prisma, audit);
  });

  it('resuelve los módulos efectivos de la empresa y cachea la segunda lectura', async () => {
    const primera = await service.resolveCapabilities('empresa-a');
    const segunda = await service.resolveCapabilities('empresa-a');
    expect(primera.modules).toMatchObject({
      catalog: true,
      quotes: false,
      tasks: true,
    });
    expect(segunda).toBe(primera);
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(1);
  });

  it('la caché está aislada por empresa: B no recibe lo de A', async () => {
    await service.resolveCapabilities('empresa-a');
    const b = await service.resolveCapabilities('empresa-b');
    expect(b.modules).toMatchObject({
      catalog: true,
      quotes: true,
      tasks: true,
    });
    expect(b.legacyDefaultsApplied).toEqual(['catalog', 'quotes', 'tasks']);
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(2);
  });

  it('expira pasado el TTL', async () => {
    const t0 = 1_000_000;
    await service.resolveCapabilities('empresa-a', t0);
    await service.resolveCapabilities(
      'empresa-a',
      t0 + CAPABILITIES_CACHE_TTL_MS - 1,
    );
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(1);
    await service.resolveCapabilities(
      'empresa-a',
      t0 + CAPABILITIES_CACHE_TTL_MS,
    );
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(2);
  });

  it('una empresa inexistente responde 404 y no se cachea', async () => {
    await expect(service.resolveCapabilities('nadie')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.resolveCapabilities('nadie')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(2);
  });

  it('escribir la configuración invalida la caché de ESA empresa', async () => {
    await service.resolveCapabilities('empresa-a');
    await service.resolveCapabilities('empresa-b');
    await service.update('empresa-a', { modules: { quotes: true } }, ACTOR);
    const a = await service.resolveCapabilities('empresa-a');
    expect(a.modules.quotes).toBe(true);
    // B sigue cacheada: una lectura de A (1), una de B (1), una de A tras el PATCH (1).
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(3);
  });

  it('en una empresa legacy (v0), desactivar un módulo conserva los otros dos', async () => {
    const config = await service.update(
      'empresa-b',
      { modules: { tasks: false } },
      ACTOR,
    );
    expect(config.storageVersion).toBe(2);
    expect(config.modules).toMatchObject({
      catalog: true,
      quotes: true,
      tasks: false,
    });
    expect(config.capabilities.legacyDefaultsApplied).toEqual([]);
    const guardado = rows['empresa-b'].settings;
    expect(guardado.commercial).toEqual({
      sellsProducts: false,
      sellsServices: false,
      usesCatalog: true,
      usesQuotes: true,
      usesTasks: false,
    });
  });

  it('en una v1 con una bandera ausente, tocar otra sección declara la ausente como activa', async () => {
    rows['empresa-a'].settings = { usesCatalog: false };
    const config = await service.update(
      'empresa-a',
      { catalog: { categories: ['Consultas'] } },
      ACTOR,
    );
    expect(config.modules).toMatchObject({
      catalog: false,
      quotes: true,
      tasks: true,
    });
    expect(rows['empresa-a'].settings.commercial).toMatchObject({
      usesCatalog: false,
      usesQuotes: true,
      usesTasks: true,
    });
  });

  it('la respuesta incluye el registro de definiciones y los tipos de catálogo', async () => {
    const config = await service.get('empresa-a');
    expect(config.capabilities.definitions.map((d) => d.key)).toEqual([
      'conversations',
      'contacts',
      'opportunities',
      'pipeline',
      'catalog',
      'quotes',
      'tasks',
    ]);
    expect(config.capabilities.catalog).toEqual({
      allowedItemTypes: ['PRODUCT', 'SERVICE'],
      defaultItemType: 'PRODUCT',
    });
  });
});
