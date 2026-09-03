import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { CompaniesService } from '../src/modules/companies/companies.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import {
  buildCodePreview,
  generateInvitationCode,
  hashInvitationCode,
  normalizeInvitationCode,
} from '../src/modules/invitation-codes/invitation-code.util';
import { CreateOnboardingCompanyDto } from '../src/modules/onboarding/dto/create-onboarding-company.dto';
import { SessionRequestContext } from '../src/modules/sessions/utils/request-context.util';

/**
 * ONBOARDING POR INDUSTRIA — contra la base real.
 *
 * Lo que un doble no demuestra: que el código de invitación se consume UNA
 * sola vez bajo concurrencia, que un código TEHUS emitido antes del cambio de
 * prefijo sigue funcionando por hash y estado, que los settings v2 quedan
 * escritos tal cual en la columna JSON, y que las categorías de una empresa
 * nunca se leen desde otra.
 *
 * Datos con prefijo E2E-PH1, limpiados al final por ID exacto.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-PH1';

const CONTEXT: SessionRequestContext = {
  deviceIdHash: 'e2e-ph1-device',
  ipPreview: '10.0.0.0',
  browser: 'jest',
  operatingSystem: 'ci',
  deviceType: 'DESKTOP',
};

describe('Onboarding por industria (e2e, base real)', () => {
  let superAdminId: string;
  let n = 0;
  const createdCompanies: string[] = [];
  const createdInvitations: string[] = [];

  const auditLog = new PlatformAuditLogService(
    prisma as unknown as PrismaService,
  );
  const companies = new CompaniesService(prisma as unknown as PrismaService);
  const service = new OnboardingService(
    prisma as unknown as PrismaService,
    { assertValidLogoFile: jest.fn(), uploadLogo: jest.fn() } as any,
    { issueSession: jest.fn(() => ({ token: 'e2e-token', user: {} })) } as any,
    auditLog,
    {
      recordLoginSuccess: jest.fn(async () => ({
        sessionId: `sess-${++n}`,
        refreshToken: `refresh-${n}`,
      })),
    } as any,
  );

  async function issue(plain: string, extra: Record<string, unknown> = {}) {
    const row = await prisma.invitationCode.create({
      data: {
        codeHash: hashInvitationCode(normalizeInvitationCode(plain)),
        codePreview: buildCodePreview(plain),
        intendedCompanyName: `${PREFIJO} invitada`,
        createdByUserId: superAdminId,
        ...extra,
      },
    });
    createdInvitations.push(row.id);
    return row;
  }

  function dto(
    overrides: {
      company?: CreateOnboardingCompanyDto['company'];
      commercial?: Partial<CreateOnboardingCompanyDto['commercial']>;
      pipeline?: CreateOnboardingCompanyDto['pipeline'];
    } = {},
  ): CreateOnboardingCompanyDto {
    const id = ++n;
    return {
      company: { name: `${PREFIJO} Empresa ${id}` },
      commercial: {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        categories: ['Productos', 'Otros'],
        industry: 'generic',
        businessType: 'products',
        ...(overrides.commercial ?? {}),
      },
      pipeline: overrides.pipeline ?? {
        name: 'Ventas',
        typedStages: [
          { name: 'Nuevo lead', type: 'OPEN' },
          { name: 'Contactado', type: 'OPEN' },
          { name: 'Cerrado ganado', type: 'WON' },
          { name: 'Cerrado perdido', type: 'LOST' },
        ],
        templateKey: 'products',
      },
      admin: {
        name: `${PREFIJO} Admin ${id}`,
        email: `e2e-ph1-admin-${id}-${Date.now()}@example.test`,
        password: 'SuperSecret!123',
      },
    };
  }

  async function create(d: CreateOnboardingCompanyDto, code: string) {
    const result = await service.createCompany(d, undefined, code, CONTEXT);
    createdCompanies.push(result.company.id);
    return result;
  }

  beforeAll(async () => {
    const sa = await prisma.user.create({
      data: {
        name: `${PREFIJO} super`,
        email: `e2e-ph1-super-${Date.now()}@example.test`,
        password: 'x',
        role: 'SUPER_ADMIN',
      },
    });
    superAdminId = sa.id;
  });

  afterAll(async () => {
    const companyIds = [...new Set(createdCompanies)];
    const users = await prisma.user.findMany({
      where: { OR: [{ companyId: { in: companyIds } }, { id: superAdminId }] },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { affectedCompanyId: { in: companyIds } },
        ],
      },
    });
    await prisma.invitationCode.deleteMany({
      where: { id: { in: createdInvitations } },
    });
    const pipelines = await prisma.pipeline.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true },
    });
    await prisma.pipelineStage.deleteMany({
      where: { pipelineId: { in: pipelines.map((p) => p.id) } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: companyIds } },
    });
    await prisma.userSession
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.loginEvent
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.$disconnect();
  });

  it('empresa genérica de servicios sin catálogo: settings v2 sin categorías y pipeline tipado con una inicial', async () => {
    const code = generateInvitationCode();
    expect(code.startsWith('TAKTO-')).toBe(true);
    await issue(code);

    const result = await create(
      dto({
        commercial: {
          sellsProducts: false,
          sellsServices: true,
          usesCatalog: false,
          usesQuotes: true,
          usesTasks: true,
          categories: ['Salas'],
          industry: 'generic',
          businessType: 'services',
          businessModel: 'services',
        },
      }),
      code,
    );

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: result.company.id },
    });
    expect(company.settings).toEqual({
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
        industry: 'generic',
        businessType: 'services',
        businessModel: 'services',
        templateVersion: 2,
      },
      pipelineDefaults: { templateKey: 'products', stagesTyped: true },
    });
    expect(company.primaryColor).toBeNull();
    expect(company.accentColor).toBeNull();

    const stages = await prisma.pipelineStage.findMany({
      where: { pipeline: { companyId: company.id } },
      orderBy: { order: 'asc' },
    });
    expect(stages.map((s) => [s.name, s.type, s.isInitial])).toEqual([
      ['Nuevo lead', 'OPEN', true],
      ['Contactado', 'OPEN', false],
      ['Cerrado ganado', 'WON', false],
      ['Cerrado perdido', 'LOST', false],
    ]);

    const invitation = await prisma.invitationCode.findUniqueOrThrow({
      where: { codeHash: hashInvitationCode(normalizeInvitationCode(code)) },
    });
    expect(invitation.status).toBe('USED');
    expect(invitation.companyId).toBe(company.id);
    expect(invitation.codePreview).toMatch(
      /^TAKTO-\*{4}-\*{4}-\*{4}-[0-9A-F]{4}$/,
    );
    const audit = await prisma.auditLog.findFirst({
      where: { affectedCompanyId: company.id, action: 'USE_INVITATION_CODE' },
    });
    expect(audit).not.toBeNull();
  });

  it('empresa de muebles: categorías de la plantilla editadas y normalizadas', async () => {
    const code = generateInvitationCode();
    await issue(code);
    const result = await create(
      dto({
        commercial: {
          categories: ['Salas', 'salas', 'Comedores', ' Exterior '],
          industry: 'furniture_decor',
          businessType: 'showroom',
        },
      }),
      code,
    );
    const settings = await companies.getSettings(result.company.id);
    expect(settings.version).toBe(2);
    expect(settings.catalog.categories).toEqual([
      'Salas',
      'Comedores',
      'Exterior',
    ]);
    expect(settings.vertical?.industry).toBe('furniture_decor');
  });

  it('veterinaria (grooming): flujo comercial, sin categorías de muebles', async () => {
    const code = generateInvitationCode();
    await issue(code);
    const result = await create(
      dto({
        commercial: {
          sellsProducts: false,
          sellsServices: true,
          usesCatalog: true,
          usesQuotes: false,
          usesTasks: true,
          categories: ['Grooming', 'Otros servicios'],
          industry: 'veterinary_pet',
          businessType: 'grooming',
        },
        pipeline: {
          name: 'Citas',
          typedStages: [
            { name: 'Nuevo contacto', type: 'OPEN' },
            { name: 'Cita agendada', type: 'OPEN' },
            { name: 'Cerrado ganado', type: 'WON' },
            { name: 'Cerrado perdido', type: 'LOST' },
          ],
          templateKey: 'grooming',
        },
      }),
      code,
    );
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: result.company.id },
    });
    expect(JSON.stringify(company.settings)).not.toMatch(
      /salas|comedor|mueble/i,
    );
    expect(company.businessType).toBe('Grooming');
  });

  it('un código TEHUS legacy activo sigue creando empresa; después queda USED y ya no sirve', async () => {
    const legacy = 'TEHUS-E2E1-AAAA-BBBB-CCCC';
    const row = await issue(legacy);
    expect(row.codePreview).toBe('TEHUS-****-****-****-CCCC');

    const first = await create(dto(), legacy);
    expect(first.company.id).toBeTruthy();

    await expect(
      service.createCompany(dto(), undefined, legacy, CONTEXT),
    ).rejects.toThrow('Código de invitación ya utilizado');
    const after = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe('USED');
    expect(after.companyId).toBe(first.company.id);
  });

  it.each([
    [
      'revocado',
      { status: 'REVOKED' as const },
      'Código de invitación revocado',
    ],
    [
      'vencido por fecha',
      { expiresAt: new Date(Date.now() - 60_000) },
      'Código de invitación vencido',
    ],
    [
      'vencido por estado',
      { status: 'EXPIRED' as const },
      'Código de invitación vencido',
    ],
  ])('rechaza un código %s sin crear nada', async (_label, extra, message) => {
    const code = generateInvitationCode();
    await issue(code, extra);
    const before = await prisma.company.count({
      where: { name: { startsWith: PREFIJO } },
    });
    await expect(
      service.createCompany(dto(), undefined, code, CONTEXT),
    ).rejects.toThrow(message);
    const after = await prisma.company.count({
      where: { name: { startsWith: PREFIJO } },
    });
    expect(after).toBe(before);
  });

  it('rechaza un código inexistente (TAKTO o TEHUS) sin crear nada', async () => {
    const before = await prisma.company.count({
      where: { name: { startsWith: PREFIJO } },
    });
    await expect(
      service.createCompany(
        dto(),
        undefined,
        'TAKTO-0000-0000-0000-0000',
        CONTEXT,
      ),
    ).rejects.toThrow('Código de invitación inválido');
    await expect(
      service.createCompany(
        dto(),
        undefined,
        'TEHUS-0000-0000-0000-0000',
        CONTEXT,
      ),
    ).rejects.toThrow('Código de invitación inválido');
    const after = await prisma.company.count({
      where: { name: { startsWith: PREFIJO } },
    });
    expect(after).toBe(before);
  });

  it('doble consumo concurrente del mismo código: exactamente UNA empresa', async () => {
    const code = generateInvitationCode();
    await issue(code);
    const outcomes = await Promise.allSettled([
      service.createCompany(dto(), undefined, code, CONTEXT),
      service.createCompany(dto(), undefined, code, CONTEXT),
    ]);
    const ok = outcomes.flatMap((o) =>
      o.status === 'fulfilled' ? [o.value] : [],
    );
    const ko = outcomes.flatMap((o) =>
      o.status === 'rejected' ? [o.reason as unknown] : [],
    );
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0]).toBeInstanceOf(BadRequestException);
    createdCompanies.push(ok[0].company.id);
    const count = await prisma.invitationCode.count({
      where: {
        codeHash: hashInvitationCode(normalizeInvitationCode(code)),
        status: 'USED',
      },
    });
    expect(count).toBe(1);
  });

  it('un pipeline tipado inválido (dos WON) se rechaza antes de consumir el código', async () => {
    const code = generateInvitationCode();
    const row = await issue(code);
    await expect(
      service.createCompany(
        dto({
          pipeline: {
            name: 'Ventas',
            typedStages: [
              { name: 'Nuevo', type: 'OPEN' },
              { name: 'Ganado', type: 'WON' },
              { name: 'Ganado 2', type: 'WON' },
              { name: 'Perdido', type: 'LOST' },
            ],
          },
        }),
        undefined,
        code,
        CONTEXT,
      ),
    ).rejects.toThrow(BadRequestException);
    const after = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe('ACTIVE');
  });

  it('aislamiento: las categorías de una empresa no se leen desde otra; settings v1 se leen y solo pasan a v2 al editar', async () => {
    const codeA = generateInvitationCode();
    await issue(codeA);
    const a = await create(
      dto({
        commercial: {
          categories: ['Vehículos', 'Accesorios'],
          industry: 'automotive',
          businessType: 'dealership',
        },
      }),
      codeA,
    );
    // Empresa B con settings v1 "a la antigua", como las creadas antes de la Fase 1.
    const b = await prisma.company.create({
      data: {
        name: `${PREFIJO} v1`,
        status: 'ACTIVE',
        settings: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: false,
          usesTasks: true,
          categories: ['Salas', 'Comedores'],
          futuro: { conservar: true },
        },
      },
    });
    createdCompanies.push(b.id);

    const settingsA = await companies.getSettings(a.company.id);
    const settingsB = await companies.getSettings(b.id);
    expect(settingsA.catalog.categories).toEqual(['Vehículos', 'Accesorios']);
    expect(settingsB.version).toBe(1);
    expect(settingsB.catalog.categories).toEqual(['Salas', 'Comedores']);
    expect(settingsA.catalog.categories).not.toContain('Salas');
    expect(settingsB.catalog.categories).not.toContain('Vehículos');

    // Leer no migra: sigue siendo v1 en la columna.
    const rawB = await prisma.company.findUniqueOrThrow({
      where: { id: b.id },
    });
    expect((rawB.settings as any).version).toBeUndefined();

    // Editar categorías desde la empresa B escribe v2, conserva banderas y claves desconocidas.
    const updated = await companies.updateSettings(b.id, {
      catalog: { categories: ['Salas', 'Dormitorios', 'salas'] },
    });
    expect(updated.version).toBe(2);
    expect(updated.catalog.categories).toEqual(['Salas', 'Dormitorios']);
    expect(updated.commercial.usesCatalog).toBe(true);
    const rawB2 = await prisma.company.findUniqueOrThrow({
      where: { id: b.id },
    });
    expect(rawB2.settings).toEqual({
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

    // A no cambió.
    const settingsA2 = await companies.getSettings(a.company.id);
    expect(settingsA2.catalog.categories).toEqual(['Vehículos', 'Accesorios']);
  });
});
