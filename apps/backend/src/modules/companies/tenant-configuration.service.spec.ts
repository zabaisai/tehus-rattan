import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TENANT_CONFIGURATION_AUDIT_ACTION,
  TenantConfigurationService,
} from './tenant-configuration.service';

/**
 * El motor con Prisma doblado. Lo que se comprueba aquí es el CONTRATO con la
 * base: qué se lee, qué se escribe, en qué orden y dentro de qué. La
 * concurrencia real (dos transacciones esperándose por el bloqueo de fila) se
 * prueba contra PostgreSQL en `test/tenant-configuration.e2e-spec.ts`.
 */
describe('TenantConfigurationService', () => {
  const ACTOR = { userId: 'user-1', role: 'ADMIN' as const };

  const V1 = {
    sellsProducts: true,
    sellsServices: false,
    usesCatalog: true,
    usesQuotes: false,
    usesTasks: true,
    categories: ['Salas', 'Comedores'],
    futuro: { conservar: true },
  };

  const ROW = {
    country: 'Colombia',
    timezone: 'America/Bogota',
    currency: 'COP',
    locale: 'es-CO',
    businessType: null as string | null,
    settings: V1 as unknown,
  };

  const PIPELINE = {
    id: 'p1',
    name: 'Ventas',
    stages: [
      { id: 's1', name: 'Nuevo', type: 'OPEN', isInitial: true, order: 0 },
      { id: 's2', name: 'Ganado', type: 'WON', isInitial: false, order: 1 },
      { id: 's3', name: 'Perdido', type: 'LOST', isInitial: false, order: 2 },
    ],
  };

  let prisma: any;
  let tx: any;
  let audit: any;
  let service: TenantConfigurationService;
  /** Orden real de las operaciones dentro de la transacción. */
  let calls: string[];

  beforeEach(() => {
    calls = [];
    let row: any = { ...ROW };
    tx = {
      $queryRaw: jest.fn(async () => {
        calls.push('lock');
        return [{ id: 'company-a' }];
      }),
      company: {
        findUnique: jest.fn(async () => {
          calls.push('read');
          return { ...row };
        }),
        update: jest.fn(async ({ data }: any) => {
          calls.push('write');
          row = { ...row, ...data };
          return { ...row };
        }),
      },
      pipeline: { findFirst: jest.fn(async () => PIPELINE) },
    };
    prisma = {
      $transaction: jest.fn(async (fn: (t: any) => Promise<unknown>) => fn(tx)),
      company: {
        findUnique: jest.fn(async () => ({ ...row })),
        update: jest.fn(),
      },
      pipeline: { findFirst: jest.fn(async () => PIPELINE) },
    };
    audit = {
      record: jest.fn(async () => {
        calls.push('audit');
      }),
    };
    service = new TenantConfigurationService(prisma, audit);
  });

  // ── lectura ────────────────────────────────────────────────────────────

  describe('get', () => {
    it('compone columnas + settings v1 + pipeline sin escribir nada', async () => {
      const config = await service.get('company-a');

      expect(config.contractVersion).toBe(1);
      expect(config.storageVersion).toBe(1);
      expect(config.regional).toEqual({
        country: 'Colombia',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
      });
      expect(config.identity.businessModel).toBe('products');
      expect(config.modules.catalog).toBe(true);
      expect(config.catalog.categories).toEqual(['Salas', 'Comedores']);
      expect(config.pipeline?.id).toBe('p1');
      expect(prisma.company.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(JSON.stringify(config)).not.toContain('futuro');
    });

    it('el pipeline se busca SIEMPRE por companyId, no archivado, default primero y con orden determinista', async () => {
      await service.get('company-a');
      expect(prisma.pipeline.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-a', isArchived: false },
          orderBy: [
            { isDefault: 'desc' },
            { order: 'asc' },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        }),
      );
    });

    it('empresa sin pipeline → pipeline: null', async () => {
      prisma.pipeline.findFirst.mockResolvedValue(null);
      const config = await service.get('company-a');
      expect(config.pipeline).toBeNull();
    });

    it('empresa sin settings (v0) → defaults, storageVersion 0, sin escritura', async () => {
      prisma.company.findUnique.mockResolvedValue({ ...ROW, settings: null });
      const config = await service.get('company-a');
      expect(config.storageVersion).toBe(0);
      expect(config.identity.businessModel).toBeNull();
      expect(config.modules).toMatchObject({
        catalog: false,
        quotes: false,
        tasks: false,
      });
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('empresa inexistente → 404', async () => {
      prisma.company.findUnique.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow(NotFoundException);
    });

    it('getLegacySettings devuelve la vista histórica sin escribir', async () => {
      const view = await service.getLegacySettings('company-a');
      expect(view.version).toBe(1);
      expect(view.catalog.categories).toEqual(['Salas', 'Comedores']);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });
  });

  // ── escritura ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('bloquea la fila, lee, escribe y audita DENTRO de la transacción, en ese orden', async () => {
      await service.update(
        'company-a',
        { regional: { timezone: 'America/Costa_Rica' } },
        ACTOR,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['lock', 'read', 'write', 'audit']);
      // El bloqueo es SELECT ... FOR UPDATE sobre companies, con el id parametrizado.
      const [strings, ...values] = tx.$queryRaw.mock.calls[0];
      expect(strings.join('?')).toMatch(
        /SELECT "id" FROM "companies" WHERE "id" = \? FOR UPDATE/,
      );
      expect(values).toEqual(['company-a']);
      // La auditoría se escribe con el cliente de la transacción, no con prisma.
      expect(audit.record.mock.calls[0][0]).toBe(tx);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('un parche solo regional escribe columnas y NO reescribe settings (v1 sigue siendo v1)', async () => {
      const config = await service.update(
        'company-a',
        {
          regional: {
            country: ' Costa  Rica ',
            timezone: 'america/costa_rica',
            currency: 'crc',
            locale: 'es-cr',
          },
        },
        ACTOR,
      );
      expect(tx.company.update).toHaveBeenCalledWith({
        where: { id: 'company-a' },
        data: {
          country: 'Costa Rica',
          timezone: 'America/Costa_Rica',
          currency: 'CRC',
          locale: 'es-CR',
        },
        select: expect.any(Object),
      });
      expect('settings' in tx.company.update.mock.calls[0][0].data).toBe(false);
      expect(config.regional).toEqual({
        country: 'Costa Rica',
        timezone: 'America/Costa_Rica',
        currency: 'CRC',
        locale: 'es-CR',
      });
      expect(config.storageVersion).toBe(1);
    });

    it('rechaza región inválida con 400 ANTES de abrir la transacción', async () => {
      await expect(
        service.update(
          'company-a',
          { regional: { timezone: 'Bogota' } },
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update('company-a', { regional: { currency: 'PESOS' } }, ACTOR),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(
          'company-a',
          { regional: { locale: 'castellano' } },
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rechaza categorías inválidas con 400 antes de abrir la transacción', async () => {
      await expect(
        service.update(
          'company-a',
          { catalog: { categories: ['x'.repeat(61)] } },
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('editar categorías convierte v1 → v2 conservando banderas, vertical y claves desconocidas', async () => {
      const config = await service.update(
        'company-a',
        { catalog: { categories: ['Salas', ' salas ', 'Dormitorios'] } },
        ACTOR,
      );
      const written = tx.company.update.mock.calls[0][0].data.settings;
      expect(written).toEqual({
        futuro: { conservar: true },
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: false,
          usesTasks: true,
        },
        catalog: { categories: ['Salas', 'Dormitorios'], allowFreeText: true },
      });
      expect(config.storageVersion).toBe(2);
      expect(config.catalog.categories).toEqual(['Salas', 'Dormitorios']);
      // Las columnas regionales no se tocan.
      expect('timezone' in tx.company.update.mock.calls[0][0].data).toBe(false);
    });

    it('módulos: catalog/quotes/tasks ↔ usesCatalog/usesQuotes/usesTasks; apagar no borra categorías', async () => {
      const config = await service.update(
        'company-a',
        { modules: { catalog: false, quotes: true } },
        ACTOR,
      );
      const written = tx.company.update.mock.calls[0][0].data.settings;
      expect(written.commercial).toEqual({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: false,
        usesQuotes: true,
        usesTasks: true,
      });
      expect(written.catalog.categories).toEqual(['Salas', 'Comedores']);
      expect(config.modules).toMatchObject({
        catalog: false,
        quotes: true,
        tasks: true,
      });
    });

    it('modelo comercial: cambiar las banderas deriva el modelo', async () => {
      const config = await service.update(
        'company-a',
        { commercial: { sellsServices: true } },
        ACTOR,
      );
      expect(config.identity.businessModel).toBe('mixed');
    });

    it('una edición explícita del modelo no puede dejar ambas banderas en falso → 400 y nada escrito', async () => {
      await expect(
        service.update(
          'company-a',
          { commercial: { sellsProducts: false } },
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.company.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('una empresa legacy con ambas banderas en falso se LEE y se puede editar otra sección sin error', async () => {
      tx.company.findUnique.mockResolvedValue({
        ...ROW,
        settings: { usesCatalog: true, categories: ['A'] },
      });
      const config = await service.update(
        'company-a',
        { catalog: { categories: ['A', 'B'] } },
        ACTOR,
      );
      expect(config.identity.businessModel).toBeNull();
      expect(config.catalog.categories).toEqual(['A', 'B']);
    });

    it('vertical y pipelineDefaults de origen se conservan al escribir v2 y nunca se pueden editar', async () => {
      tx.company.findUnique.mockResolvedValue({
        ...ROW,
        settings: {
          version: 2,
          commercial: { ...V1, categories: undefined },
          catalog: { categories: ['A'], allowFreeText: true },
          vertical: {
            industry: 'furniture_decor',
            businessType: 'showroom',
            businessModel: 'products',
            templateVersion: 2,
          },
          pipelineDefaults: { templateKey: 'showroom', stagesTyped: true },
        },
      });
      const config = await service.update(
        'company-a',
        { modules: { tasks: false } },
        ACTOR,
      );
      const written = tx.company.update.mock.calls[0][0].data.settings;
      expect(written.vertical).toEqual({
        industry: 'furniture_decor',
        businessType: 'showroom',
        businessModel: 'products',
        templateVersion: 2,
      });
      expect(written.pipelineDefaults).toEqual({
        templateKey: 'showroom',
        stagesTyped: true,
      });
      expect(config.identity.industry).toBe('furniture_decor');
    });

    it('un parche vacío no escribe, no audita y devuelve la configuración actual', async () => {
      const config = await service.update('company-a', {}, ACTOR);
      expect(tx.company.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(config.storageVersion).toBe(1);
    });

    it('empresa inexistente (bloqueo sin fila) → 404 sin escribir', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.update('nope', { regional: { currency: 'USD' } }, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(tx.company.update).not.toHaveBeenCalled();
    });

    it('la auditoría registra actor, empresa, acción, entidad, secciones y campos; sin valores ni secretos', async () => {
      await service.update(
        'company-a',
        {
          regional: { timezone: 'America/Costa_Rica' },
          catalog: { categories: ['Consultas'] },
        },
        { userId: 'admin-7', role: 'ADMIN' },
      );
      const [, input] = audit.record.mock.calls[0];
      expect(input).toEqual({
        actorUserId: 'admin-7',
        actorRole: 'ADMIN',
        affectedCompanyId: 'company-a',
        action: TENANT_CONFIGURATION_AUDIT_ACTION,
        entityType: 'Company',
        entityId: 'company-a',
        metadata: {
          contractVersion: 1,
          sections: ['regional', 'catalog'],
          fields: ['regional.timezone', 'catalog.categories'],
          storageVersion: { before: 1, after: 2 },
        },
      });
      expect(JSON.stringify(input)).not.toContain('America/Costa_Rica');
      expect(JSON.stringify(input)).not.toContain('Consultas');
    });

    it('si la auditoría falla, la transacción falla (el cambio no queda sin rastro)', async () => {
      audit.record.mockRejectedValue(new Error('audit down'));
      await expect(
        service.update('company-a', { regional: { currency: 'USD' } }, ACTOR),
      ).rejects.toThrow('audit down');
    });
  });

  // ── endpoint histórico ─────────────────────────────────────────────────

  describe('updateLegacySettings (PATCH /companies/me/settings)', () => {
    it('traduce el DTO histórico al parche común y devuelve la vista histórica', async () => {
      const view = await service.updateLegacySettings(
        'company-a',
        {
          catalog: { categories: ['Salas', 'Dormitorios'] },
          commercial: { usesQuotes: true, sellsServices: true },
        },
        ACTOR,
      );
      const written = tx.company.update.mock.calls[0][0].data.settings;
      expect(written.commercial).toEqual({
        sellsProducts: true,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
      });
      expect(view.version).toBe(2);
      expect(view.catalog.categories).toEqual(['Salas', 'Dormitorios']);
      expect(view.commercial.usesQuotes).toBe(true);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][1].metadata.sections).toEqual([
        'commercial',
        'modules',
        'catalog',
      ]);
    });

    it('aplica la misma regla: ambas ventas en falso por edición explícita → 400', async () => {
      await expect(
        service.updateLegacySettings(
          'company-a',
          { commercial: { sellsProducts: false, sellsServices: false } },
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.company.update).not.toHaveBeenCalled();
    });
  });
});
