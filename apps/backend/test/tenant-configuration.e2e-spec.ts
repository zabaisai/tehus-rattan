import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { CompaniesController } from '../src/modules/companies/companies.controller';
import { CompaniesService } from '../src/modules/companies/companies.service';
import { CompanyBrandingService } from '../src/modules/companies/company-branding.service';
import { TenantConfigurationService } from '../src/modules/companies/tenant-configuration.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import {
  crearAppHttp,
  crearEmpresaE2E,
  EmpresaE2E,
  limpiarEmpresasE2E,
  tokenDe,
} from './helpers/tenant-http';

/**
 * MOTOR DE CONFIGURACIÓN POR EMPRESA — HTTP real, base real, sesiones reales.
 *
 * Lo que un doble no demuestra: que el bloqueo de fila hace que dos PATCH
 * simultáneos conserven ambos cambios, que las columnas regionales quedan
 * escritas, que una empresa sin settings responde 200 sin que nadie le
 * escriba nada, que un asesor lee pero no modifica, y que la empresa A no
 * ve ni toca a la B.
 *
 * Datos con prefijo E2E-CFG, borrados al final por ID exacto.
 */
const PREFIJO = 'E2E-CFG';
const prisma = new PrismaService();

describe('Configuración por empresa (e2e, HTTP + base real)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const empresas: EmpresaE2E[] = [];

  /** Empresa con settings v1 (como las anteriores a la Fase 1). */
  let A: EmpresaE2E;
  /** Empresa con settings v2 creada como lo hace el onboarding. */
  let B: EmpresaE2E;
  /** Empresa legacy: sin settings, sin pipeline. */
  let L: EmpresaE2E;

  beforeAll(async () => {
    await prisma.$connect();
    ({ app, jwt } = await crearAppHttp({
      prisma,
      controllers: [CompaniesController],
      providers: [
        CompaniesService,
        TenantConfigurationService,
        PlatformAuditLogService,
        {
          provide: CompanyBrandingService,
          useValue: { uploadLogo: jest.fn() },
        },
      ],
    }));

    A = await crearEmpresaE2E(prisma, PREFIJO, {
      settings: {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: false,
        usesTasks: true,
        categories: ['Salas', 'Comedores'],
        futuro: { conservar: true },
      },
      country: 'Colombia',
      businessType: 'Tienda de muebles',
    });
    B = await crearEmpresaE2E(prisma, PREFIJO, {
      settings: {
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
      country: 'Costa Rica',
      timezone: 'America/Costa_Rica',
      currency: 'CRC',
      locale: 'es-CR',
    });
    L = await crearEmpresaE2E(prisma, PREFIJO);
    empresas.push(A, B, L);

    // A: dos pipelines SIN isDefault (legacy): gana el de menor `order`.
    await prisma.pipeline.create({
      data: {
        companyId: A.companyId,
        name: 'Secundario',
        order: 5,
        stages: { create: [{ name: 'Etapa X', order: 0 }] },
      },
    });
    await prisma.pipeline.create({
      data: {
        companyId: A.companyId,
        name: 'Principal',
        order: 1,
        stages: {
          create: [
            { name: 'Nuevo', order: 0, type: 'OPEN', isInitial: true },
            { name: 'Ganado', order: 1, type: 'WON' },
            { name: 'Perdido', order: 2, type: 'LOST' },
          ],
        },
      },
    });
    // A también tiene uno archivado marcado default: NO debe ganar.
    await prisma.pipeline.create({
      data: {
        companyId: A.companyId,
        name: 'Archivado',
        order: 0,
        isArchived: true,
        stages: { create: [{ name: 'Vieja', order: 0 }] },
      },
    });
    // B: pipeline default explícito, como lo crea el onboarding.
    await prisma.pipeline.create({
      data: {
        companyId: B.companyId,
        name: 'Citas',
        isDefault: true,
        stages: {
          create: [
            { name: 'Solicitud', order: 0, type: 'OPEN', isInitial: true },
            { name: 'Atendida', order: 1, type: 'WON' },
            { name: 'Cancelada', order: 2, type: 'LOST' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await limpiarEmpresasE2E(prisma, empresas);
    await app?.close();
    await prisma.$disconnect();
  });

  const get = (ruta: string, token?: string) => {
    const r = request(app.getHttpServer()).get(`/api${ruta}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const patch = (ruta: string, token: string | undefined, body: unknown) => {
    const r = request(app.getHttpServer())
      .patch(`/api${ruta}`)
      .send(body as object);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  // ── lectura ────────────────────────────────────────────────────────────

  it('ADMIN lee el contrato v1 de una empresa con settings v1: región de las columnas, modelo derivado, pipeline por fallback determinista', async () => {
    const res = await get(
      '/companies/me/configuration',
      tokenDe(jwt, A, 'admin'),
    );
    expect(res.status).toBe(200);
    expect(res.body.contractVersion).toBe(1);
    expect(res.body.storageVersion).toBe(1);
    expect(res.body.identity).toEqual({
      industry: null,
      businessType: 'Tienda de muebles',
      businessModel: 'products',
      templateVersion: null,
    });
    expect(res.body.regional).toEqual({
      country: 'Colombia',
      timezone: 'America/Bogota',
      currency: 'COP',
      locale: 'es-CO',
    });
    expect(res.body.modules).toEqual({
      conversations: true,
      contacts: true,
      opportunities: true,
      pipeline: true,
      catalog: true,
      quotes: false,
      tasks: true,
    });
    expect(res.body.catalog).toEqual({
      categories: ['Salas', 'Comedores'],
      allowFreeText: true,
    });
    expect(res.body.pipeline.name).toBe('Principal');
    expect(
      res.body.pipeline.stages.map((s: any) => [s.name, s.type, s.isInitial]),
    ).toEqual([
      ['Nuevo', 'OPEN', true],
      ['Ganado', 'WON', false],
      ['Perdido', 'LOST', false],
    ]);
    expect(JSON.stringify(res.body)).not.toContain('futuro');
    // Leer no escribe: la columna sigue siendo v1.
    const raw = await prisma.company.findUniqueOrThrow({
      where: { id: A.companyId },
      select: { settings: true },
    });
    expect((raw.settings as any).version).toBeUndefined();
  });

  it('empresa con settings v2 (onboarding): identidad de la plantilla, región de sus columnas y pipeline default', async () => {
    const res = await get(
      '/companies/me/configuration',
      tokenDe(jwt, B, 'admin'),
    );
    expect(res.status).toBe(200);
    expect(res.body.storageVersion).toBe(2);
    expect(res.body.identity).toEqual({
      industry: 'veterinary',
      businessType: 'clinic',
      businessModel: 'services',
      templateVersion: 2,
    });
    expect(res.body.regional).toEqual({
      country: 'Costa Rica',
      timezone: 'America/Costa_Rica',
      currency: 'CRC',
      locale: 'es-CR',
    });
    expect(res.body.pipeline.name).toBe('Citas');
    expect(res.body.catalog.categories).toEqual(['Consultas', 'Vacunas']);
  });

  it('empresa legacy sin settings ni pipeline responde 200 con defaults y nadie le escribe', async () => {
    const res = await get(
      '/companies/me/configuration',
      tokenDe(jwt, L, 'admin'),
    );
    expect(res.status).toBe(200);
    expect(res.body.storageVersion).toBe(0);
    expect(res.body.identity.businessModel).toBeNull();
    expect(res.body.regional).toEqual({
      country: null,
      timezone: 'America/Bogota',
      currency: 'COP',
      locale: 'es-CO',
    });
    expect(res.body.pipeline).toBeNull();
    expect(res.body.modules).toMatchObject({
      catalog: false,
      quotes: false,
      tasks: false,
    });
    const raw = await prisma.company.findUniqueOrThrow({
      where: { id: L.companyId },
      select: { settings: true },
    });
    expect(raw.settings).toBeNull();
  });

  it('AGENT puede consultar la configuración de su empresa', async () => {
    const res = await get(
      '/companies/me/configuration',
      tokenDe(jwt, A, 'agent'),
    );
    expect(res.status).toBe(200);
    expect(res.body.catalog.categories).toEqual(['Salas', 'Comedores']);
  });

  it('sin token → 401; los dos endpoints', async () => {
    expect((await get('/companies/me/configuration')).status).toBe(401);
    expect(
      (await patch('/companies/me/configuration', undefined, {})).status,
    ).toBe(401);
    expect((await get('/companies/me/settings')).status).toBe(401);
  });

  // ── escritura ──────────────────────────────────────────────────────────

  it('AGENT no puede modificar (403) y nada cambia', async () => {
    const res = await patch(
      '/companies/me/configuration',
      tokenDe(jwt, A, 'agent'),
      {
        regional: { currency: 'USD' },
      },
    );
    expect(res.status).toBe(403);
    const row = await prisma.company.findUniqueOrThrow({
      where: { id: A.companyId },
      select: { currency: true },
    });
    expect(row.currency).toBe('COP');
  });

  it('ADMIN modifica región, modelo, módulos y categorías de SU empresa; queda en columnas + settings v2 + auditoría', async () => {
    const res = await patch(
      '/companies/me/configuration',
      tokenDe(jwt, A, 'admin'),
      {
        regional: {
          timezone: 'america/bogota',
          currency: 'cop',
          locale: 'es-co',
          country: ' Colombia ',
        },
        commercial: { sellsServices: true },
        modules: { quotes: true },
        catalog: { categories: ['Salas', 'Comedores', 'Instalación'] },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.storageVersion).toBe(2);
    expect(res.body.identity.businessModel).toBe('mixed');
    expect(res.body.modules.quotes).toBe(true);
    expect(res.body.catalog.categories).toEqual([
      'Salas',
      'Comedores',
      'Instalación',
    ]);
    expect(res.body.regional).toEqual({
      country: 'Colombia',
      timezone: 'America/Bogota',
      currency: 'COP',
      locale: 'es-CO',
    });

    const raw = await prisma.company.findUniqueOrThrow({
      where: { id: A.companyId },
      select: { settings: true, timezone: true, currency: true, locale: true },
    });
    expect(raw.settings).toEqual({
      futuro: { conservar: true },
      version: 2,
      commercial: {
        sellsProducts: true,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
      },
      catalog: {
        categories: ['Salas', 'Comedores', 'Instalación'],
        allowFreeText: true,
      },
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        affectedCompanyId: A.companyId,
        action: 'company.configuration.update',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(A.admin.userId);
    expect(audit!.actorRole).toBe('ADMIN');
    expect(audit!.entityType).toBe('Company');
    expect(audit!.entityId).toBe(A.companyId);
    expect((audit!.metadata as any).sections).toEqual([
      'regional',
      'commercial',
      'modules',
      'catalog',
    ]);
    expect((audit!.metadata as any).storageVersion).toEqual({
      before: 1,
      after: 2,
    });
    expect(JSON.stringify(audit!.metadata)).not.toContain('Instalación');
  });

  it('el endpoint histórico GET /settings sigue funcionando y refleja el mismo estado', async () => {
    const res = await get('/companies/me/settings', tokenDe(jwt, A, 'agent'));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.commercial.usesQuotes).toBe(true);
    expect(res.body.catalog.categories).toEqual([
      'Salas',
      'Comedores',
      'Instalación',
    ]);
    expect(res.body.limits.categories).toEqual({ maxLength: 60, maxCount: 30 });
  });

  it('el endpoint histórico PATCH /settings pasa por el mismo motor (misma auditoría) y sigue rechazando a un AGENT', async () => {
    expect(
      (
        await patch('/companies/me/settings', tokenDe(jwt, A, 'agent'), {
          catalog: { categories: ['X'] },
        })
      ).status,
    ).toBe(403);

    const antes = await prisma.auditLog.count({
      where: {
        affectedCompanyId: A.companyId,
        action: 'company.configuration.update',
      },
    });
    const res = await patch(
      '/companies/me/settings',
      tokenDe(jwt, A, 'admin'),
      {
        commercial: { usesTasks: false },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.commercial.usesTasks).toBe(false);
    const despues = await prisma.auditLog.count({
      where: {
        affectedCompanyId: A.companyId,
        action: 'company.configuration.update',
      },
    });
    expect(despues).toBe(antes + 1);
    // Apagar tareas no borró nada más.
    const cfg = await get(
      '/companies/me/configuration',
      tokenDe(jwt, A, 'admin'),
    );
    expect(cfg.body.catalog.categories).toEqual([
      'Salas',
      'Comedores',
      'Instalación',
    ]);
  });

  // ── casos negativos ────────────────────────────────────────────────────

  it.each([
    ['timezone inválida', { regional: { timezone: 'Bogota' } }],
    ['timezone como desplazamiento', { regional: { timezone: '+05:00' } }],
    ['currency inválida', { regional: { currency: 'PESOS' } }],
    ['currency desconocida', { regional: { currency: 'ZZZ' } }],
    ['locale inválido', { regional: { locale: 'castellano' } }],
    ['campo desconocido', { regional: { timezone: 'UTC' }, color: 'rojo' }],
    ['settings completo', { settings: { version: 2 } }],
    ['storageVersion', { storageVersion: 1 }],
    ['identity', { identity: { industry: 'generic' } }],
    ['pipeline', { pipeline: { id: 'x', name: 'y', stages: [] } }],
    [
      'pipelineDefaults',
      { pipelineDefaults: { templateKey: 'x', stagesTyped: true } },
    ],
    ['companyId', { companyId: 'otra' }],
    [
      'ambas ventas en falso',
      { commercial: { sellsProducts: false, sellsServices: false } },
    ],
    [
      'categoría demasiado larga',
      { catalog: { categories: ['x'.repeat(61)] } },
    ],
  ])('rechaza con 400 y sin escribir: %s', async (_nombre, body) => {
    const antes = await prisma.company.findUniqueOrThrow({
      where: { id: B.companyId },
      select: {
        settings: true,
        timezone: true,
        currency: true,
        locale: true,
        updatedAt: true,
      },
    });
    const res = await patch(
      '/companies/me/configuration',
      tokenDe(jwt, B, 'admin'),
      body,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/); // sin stack interno
    const despues = await prisma.company.findUniqueOrThrow({
      where: { id: B.companyId },
      select: {
        settings: true,
        timezone: true,
        currency: true,
        locale: true,
        updatedAt: true,
      },
    });
    expect(despues).toEqual(antes);
  });

  it('una empresa legacy con ambas ventas en falso puede editar región y categorías sin tocar el modelo', async () => {
    const res = await patch(
      '/companies/me/configuration',
      tokenDe(jwt, L, 'admin'),
      {
        regional: { country: 'Panamá' },
        catalog: { categories: ['General'] },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.identity.businessModel).toBeNull();
    expect(res.body.regional.country).toBe('Panamá');
    expect(res.body.storageVersion).toBe(2);
  });

  // ── aislamiento ────────────────────────────────────────────────────────

  it('Tenant A no ve la configuración de B y sus cambios no llegan a B', async () => {
    const a = await get(
      '/companies/me/configuration',
      tokenDe(jwt, A, 'admin'),
    );
    const b = await get(
      '/companies/me/configuration',
      tokenDe(jwt, B, 'admin'),
    );
    expect(a.body.catalog.categories).not.toContain('Consultas');
    expect(b.body.catalog.categories).not.toContain('Salas');
    expect(a.body.pipeline.id).not.toBe(b.body.pipeline.id);
    expect(b.body.regional.currency).toBe('CRC');
    expect(b.body.storageVersion).toBe(2);
    expect(b.body.identity.industry).toBe('veterinary');
    // El PATCH de A (arriba) no dejó rastro de auditoría sobre B.
    const auditB = await prisma.auditLog.count({
      where: {
        affectedCompanyId: B.companyId,
        action: 'company.configuration.update',
      },
    });
    expect(auditB).toBe(0);
  });

  // ── concurrencia ───────────────────────────────────────────────────────

  it('dos PATCH simultáneos (región y categorías) conservan AMBOS cambios', async () => {
    const token = tokenDe(jwt, B, 'admin');
    const [r1, r2] = await Promise.all([
      patch('/companies/me/configuration', token, {
        regional: {
          timezone: 'America/Panama',
          currency: 'USD',
          locale: 'es-PA',
          country: 'Panamá',
        },
      }),
      patch('/companies/me/configuration', token, {
        catalog: { categories: ['Consultas', 'Vacunas', 'Cirugía'] },
        modules: { quotes: false },
      }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const final = await get('/companies/me/configuration', token);
    expect(final.body.regional).toEqual({
      country: 'Panamá',
      timezone: 'America/Panama',
      currency: 'USD',
      locale: 'es-PA',
    });
    expect(final.body.catalog.categories).toEqual([
      'Consultas',
      'Vacunas',
      'Cirugía',
    ]);
    expect(final.body.modules.quotes).toBe(false);
    // El vertical de origen sobrevive a las dos escrituras.
    expect(final.body.identity.industry).toBe('veterinary');
    const raw = await prisma.company.findUniqueOrThrow({
      where: { id: B.companyId },
      select: { settings: true },
    });
    expect((raw.settings as any).vertical.templateVersion).toBe(2);
    expect((raw.settings as any).pipelineDefaults).toEqual({
      templateKey: 'clinic',
      stagesTyped: true,
    });
  });

  it('dos PATCH simultáneos sobre la MISMA sección (categorías) no dejan un estado corrupto: gana uno de los dos, completo', async () => {
    const token = tokenDe(jwt, B, 'admin');
    const [r1, r2] = await Promise.all([
      patch('/companies/me/configuration', token, {
        catalog: { categories: ['Uno'] },
      }),
      patch('/companies/me/configuration', token, {
        catalog: { categories: ['Dos'] },
      }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const final = await get('/companies/me/configuration', token);
    expect([['Uno'], ['Dos']]).toContainEqual(final.body.catalog.categories);
    expect(final.body.regional.currency).toBe('USD');
  });
});
