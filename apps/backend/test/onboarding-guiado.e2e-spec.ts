import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { OnboardingController } from '../src/modules/onboarding/onboarding.controller';
import { OnboardingTemplatesController } from '../src/modules/onboarding/onboarding-templates.controller';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { CompanyBrandingService } from '../src/modules/companies/company-branding.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { TenantConfigurationService } from '../src/modules/companies/tenant-configuration.service';
import {
  buildCodePreview,
  generateInvitationCode,
  hashInvitationCode,
  normalizeInvitationCode,
} from '../src/modules/invitation-codes/invitation-code.util';
import { crearAppHttp } from './helpers/tenant-http';

/**
 * ONBOARDING GUIADO (Fase 3) — HTTP real, base real.
 *
 * Recorre `POST /api/onboarding/company` y `POST /api/onboarding/invitation/check`
 * como lo hace el asistente: cuatro industrias (muebles, veterinaria y pet
 * shop, software, «Otro»), códigos TAKTO y uno TEHUS temporal, estados del
 * código, doble clic y concurrencia, mass assignment, invariantes de pipeline y
 * categorías, y aislamiento. Después de cada fallo comprueba que no quedó nada
 * a medias. Datos con prefijo E2E-ONB3, borrados por ID exacto.
 */
const prisma = new PrismaService();
const PREFIJO = 'E2E-ONB3';
const HEADER = 'X-Onboarding-Invite-Code';
const PASSWORD = 'SuperSecret!123';

describe('Onboarding guiado (e2e, HTTP + base real)', () => {
  let app: INestApplication<App>;
  let superAdminId: string;
  let configuracion: TenantConfigurationService;
  const invitations: string[] = [];
  const companies: string[] = [];
  let n = 0;

  async function issue(
    plain = generateInvitationCode(),
    extra: Record<string, unknown> = {},
  ) {
    const row = await prisma.invitationCode.create({
      data: {
        codeHash: hashInvitationCode(normalizeInvitationCode(plain)),
        codePreview: buildCodePreview(plain),
        intendedCompanyName: `${PREFIJO} invitada`,
        createdByUserId: superAdminId,
        ...extra,
      },
      select: { id: true },
    });
    invitations.push(row.id);
    return { plain, id: row.id };
  }

  function payload(over: Record<string, any> = {}) {
    const id = ++n;
    const base: Record<string, any> = {
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
        businessModel: 'products',
      },
      pipeline: {
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
        email: `e2e-onb3-admin-${id}-${Date.now()}@example.test`,
        password: PASSWORD,
      },
      agents: [],
    };
    return deepMerge(base, over);
  }

  function deepMerge(a: any, b: any): any {
    if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] =
        k in out && typeof out[k] === 'object' && !Array.isArray(out[k])
          ? deepMerge(out[k], v)
          : v;
    }
    return out;
  }

  const post = (ruta: string, code: string | undefined, body: unknown) => {
    const r = request(app.getHttpServer())
      .post(`/api${ruta}`)
      .send(body as object);
    return code !== undefined ? r.set(HEADER, code) : r;
  };

  async function snapshot() {
    return {
      companies: await prisma.company.count({
        where: { name: { startsWith: PREFIJO } },
      }),
      users: await prisma.user.count({
        where: { email: { startsWith: 'e2e-onb3-' } },
      }),
      pipelines: await prisma.pipeline.count({
        where: { company: { name: { startsWith: PREFIJO } } },
      }),
      used: await prisma.invitationCode.count({
        where: { id: { in: invitations }, status: 'USED' },
      }),
    };
  }

  beforeAll(async () => {
    await prisma.$connect();
    const sa = await prisma.user.create({
      data: {
        email: `e2e-onb3-superadmin-${Date.now()}@example.test`,
        password: await bcrypt.hash(PASSWORD, 4),
        name: `${PREFIJO} Super Admin`,
        role: 'SUPER_ADMIN',
      },
      select: { id: true },
    });
    superAdminId = sa.id;
    const audit = new PlatformAuditLogService(prisma);
    configuracion = new TenantConfigurationService(prisma, audit);
    ({ app } = await crearAppHttp({
      prisma,
      controllers: [OnboardingController, OnboardingTemplatesController],
      providers: [
        OnboardingService,
        CompanyBrandingService,
        { provide: PlatformAuditLogService, useValue: audit },
        {
          provide: AuthService,
          useValue: {
            issueSession: (user: {
              id: string;
              email: string;
              name: string;
            }) => ({
              token: 'e2e-token',
              user: { id: user.id, email: user.email, name: user.name },
            }),
          },
        },
        {
          provide: SessionsService,
          useValue: {
            recordLoginSuccess: async () => ({
              sessionId: `sess-${Date.now()}-${Math.random()}`,
              refreshToken: 'e2e-refresh',
            }),
          },
        },
      ],
    }));
  });

  afterAll(async () => {
    const ids = (
      await prisma.company.findMany({
        where: { name: { startsWith: PREFIJO } },
        select: { id: true },
      })
    ).map((c) => c.id);
    const userIds = (
      await prisma.user.findMany({
        where: { email: { startsWith: 'e2e-onb3-' } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { affectedCompanyId: { in: ids } },
          { actorUserId: { in: userIds } },
        ],
      },
    });
    await prisma.invitationCode.deleteMany({
      where: {
        OR: [{ id: { in: invitations } }, { createdByUserId: superAdminId }],
      },
    });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: ids } } },
    });
    await prisma.pipeline.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.loginEvent
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
    await prisma.$disconnect();
  });

  // ── plantillas ───────────────────────────────────────────────────────────

  it('GET /onboarding/templates publica la versión 3 con las cuatro plantillas mínimas y sin muebles fuera de muebles', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/onboarding/templates',
    );
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    const keys = Object.fromEntries(
      res.body.industries.map((i: any) => [
        i.key,
        i.businessTypes.map((t: any) => t.key),
      ]),
    );
    expect(keys.furniture_decor).toContain('showroom');
    expect(keys.veterinary_pet[0]).toBe('vet_petshop');
    expect(keys.professional_services[0]).toBe('software');
    expect(keys.generic).toContain('other');
    for (const industry of res.body.industries) {
      if (industry.key === 'furniture_decor') continue;
      expect(JSON.stringify(industry)).not.toMatch(
        /\b(salas?|comedor(es)?|sillas?|muebles|tehus)\b/i,
      );
    }
    expect(res.body.limits.categories).toEqual({ maxLength: 60, maxCount: 30 });
  });

  // ── comprobación del código sin consumirlo ───────────────────────────────

  describe('POST /onboarding/invitation/check', () => {
    it('un código TAKTO activo es válido y sigue ACTIVE después', async () => {
      const inv = await issue();
      const res = await post('/onboarding/invitation/check', inv.plain, {});
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ valid: true });
      const row = await prisma.invitationCode.findUniqueOrThrow({
        where: { id: inv.id },
      });
      expect(row.status).toBe('ACTIVE');
      expect(row.usedAt).toBeNull();
    });

    it('un código TEHUS temporal activo también es válido (compatibilidad por hash)', async () => {
      const inv = await issue(`TEHUS-${randomGroups()}`);
      const res = await post('/onboarding/invitation/check', inv.plain, {});
      expect(res.status).toBe(201);
    });

    it('sin header → 400; inexistente → 400 «inválido»; revocado, usado y vencido → 400 con su motivo', async () => {
      expect(
        (await post('/onboarding/invitation/check', undefined, {})).status,
      ).toBe(400);
      const nope = await post(
        '/onboarding/invitation/check',
        'TAKTO-0000-0000-0000-0000',
        {},
      );
      expect(nope.status).toBe(400);
      expect(nope.body.message).toMatch(/inválido/);
      const revoked = await issue(undefined, {
        status: 'REVOKED',
        revokedAt: new Date(),
      });
      expect(
        (await post('/onboarding/invitation/check', revoked.plain, {})).body
          .message,
      ).toMatch(/revocado/);
      const used = await issue(undefined, {
        status: 'USED',
        usedAt: new Date(),
      });
      expect(
        (await post('/onboarding/invitation/check', used.plain, {})).body
          .message,
      ).toMatch(/ya utilizado/);
      const expired = await issue(undefined, {
        expiresAt: new Date(Date.now() - 60_000),
      });
      expect(
        (await post('/onboarding/invitation/check', expired.plain, {})).body
          .message,
      ).toMatch(/vencido/);
    });

    it('la respuesta no filtra nada del código ni de la empresa prevista', async () => {
      const inv = await issue();
      const res = await post('/onboarding/invitation/check', inv.plain, {});
      expect(JSON.stringify(res.body)).not.toMatch(
        /invitada|TAKTO|preview|expires/i,
      );
    });
  });

  // ── las cuatro industrias ────────────────────────────────────────────────

  async function crear(over: Record<string, any>, plain?: string) {
    const inv = await issue(plain);
    const res = await post('/onboarding/company', inv.plain, payload(over));
    if (res.status === 201) companies.push(res.body.company.id);
    return { res, inv };
  }

  it('mueblería (showroom, Colombia): mixta, categorías de muebles, pipeline de 7 etapas, región COP', async () => {
    const { res, inv } = await crear({
      company: {
        name: `${PREFIJO} Muebles`,
        country: 'Colombia',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
      },
      commercial: {
        sellsProducts: true,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        categories: [
          'Salas',
          'Comedores',
          'Sillas',
          'Decoración',
          'Instalación',
        ],
        industry: 'furniture_decor',
        businessType: 'showroom',
        businessModel: 'mixed',
      },
      pipeline: {
        name: 'Ventas',
        typedStages: [
          { name: 'Nuevo lead', type: 'OPEN' },
          { name: 'Contactado', type: 'OPEN' },
          { name: 'Asesoría en proceso', type: 'OPEN' },
          { name: 'Cotización', type: 'OPEN' },
          { name: 'Seguimiento', type: 'OPEN' },
          { name: 'Cerrado ganado', type: 'WON' },
          { name: 'Cerrado perdido', type: 'LOST' },
        ],
        templateKey: 'showroom',
      },
      agents: [
        {
          name: 'Asesora',
          email: `e2e-onb3-agent-m-${Date.now()}@example.test`,
          password: PASSWORD,
          role: 'AGENT',
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('e2e-token');
    expect(res.body.company.status).toBe('ACTIVE');
    expect(res.body.stages.map((s: any) => [s.type, s.isInitial])).toEqual([
      ['OPEN', true],
      ['OPEN', false],
      ['OPEN', false],
      ['OPEN', false],
      ['OPEN', false],
      ['WON', false],
      ['LOST', false],
    ]);

    const cfg = await configuracion.get(res.body.company.id);
    expect(cfg.storageVersion).toBe(2);
    expect(cfg.identity).toEqual({
      industry: 'furniture_decor',
      businessType: 'showroom',
      businessModel: 'mixed',
      templateVersion: 3,
    });
    expect(cfg.regional).toEqual({
      country: 'Colombia',
      timezone: 'America/Bogota',
      currency: 'COP',
      locale: 'es-CO',
    });
    expect(cfg.modules).toMatchObject({
      catalog: true,
      quotes: true,
      tasks: true,
    });
    expect(cfg.catalog.categories).toEqual([
      'Salas',
      'Comedores',
      'Sillas',
      'Decoración',
      'Instalación',
    ]);
    expect(cfg.pipeline?.name).toBe('Ventas');
    expect(cfg.pipeline?.stages).toHaveLength(7);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: res.body.company.id },
    });
    expect(company.businessType).toBe('Tienda / showroom');
    const users = await prisma.user.findMany({
      where: { companyId: company.id },
      orderBy: { role: 'asc' },
    });
    expect(users.map((u) => u.role).sort()).toEqual(['ADMIN', 'AGENT']);
    expect(users.every((u) => u.companyId === company.id)).toBe(true);
    // La contraseña se guarda como hash y sirve para iniciar sesión.
    const admin = users.find((u) => u.role === 'ADMIN')!;
    expect(admin.password).not.toBe(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, admin.password)).toBe(true);

    const invitation = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(invitation.status).toBe('USED');
    expect(invitation.companyId).toBe(company.id);
    expect(invitation.usedByUserId).toBe(admin.id);

    const audit = await prisma.auditLog.findFirst({
      where: { affectedCompanyId: company.id, action: 'USE_INVITATION_CODE' },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as any;
    expect(meta.onboarding).toMatchObject({
      templateVersion: 3,
      industry: 'furniture_decor',
      businessType: 'showroom',
      businessModel: 'mixed',
      stagesCount: 7,
      agentsCount: 1,
      categoriesCount: 5,
      regional: {
        country: 'Colombia',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
      },
    });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(inv.plain);
    expect(serialized).not.toContain(admin.password);
  });

  it('veterinaria y pet shop (Costa Rica): mixta, categorías propias sin muebles, región CRC / es-CR', async () => {
    const { res } = await crear({
      company: {
        name: `${PREFIJO} Vet`,
        country: 'Costa Rica',
        timezone: 'america/costa_rica',
        currency: 'crc',
        locale: 'es-cr',
      },
      commercial: {
        sellsProducts: true,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: false,
        usesTasks: true,
        categories: [
          'Consultas',
          'Vacunas',
          'Peluquería',
          'Alimentos',
          'Medicamentos',
        ],
        industry: 'veterinary_pet',
        businessType: 'vet_petshop',
        businessModel: 'mixed',
      },
      pipeline: {
        name: 'Citas y pedidos',
        typedStages: [
          { name: 'Nueva solicitud', type: 'OPEN' },
          { name: 'Contactado', type: 'OPEN' },
          { name: 'Cita o pedido confirmado', type: 'OPEN' },
          { name: 'Seguimiento', type: 'OPEN' },
          { name: 'Cerrado ganado', type: 'WON' },
          { name: 'Cerrado perdido', type: 'LOST' },
        ],
        templateKey: 'vet_petshop',
      },
    });
    expect(res.status).toBe(201);
    const cfg = await configuracion.get(res.body.company.id);
    expect(cfg.regional).toEqual({
      country: 'Costa Rica',
      timezone: 'America/Costa_Rica',
      currency: 'CRC',
      locale: 'es-CR',
    });
    expect(cfg.identity.businessType).toBe('vet_petshop');
    expect(cfg.modules.quotes).toBe(false);
    expect(JSON.stringify(cfg.catalog.categories)).not.toMatch(
      /salas|comedor|sillas/i,
    );
    expect(cfg.pipeline?.stages.map((s) => s.name)).toContain(
      'Cita o pedido confirmado',
    );
  });

  it('software (servicios): sin productos, categorías de servicios, pipeline con Descubrimiento; el cliente antiguo de catálogo crea PRODUCT', async () => {
    const { res } = await crear({
      company: {
        name: `${PREFIJO} Software`,
        country: 'México',
        timezone: 'America/Mexico_City',
        currency: 'MXN',
        locale: 'es-MX',
      },
      commercial: {
        sellsProducts: false,
        sellsServices: true,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        categories: ['Implementación', 'Consultoría', 'Soporte', 'Licencias'],
        industry: 'professional_services',
        businessType: 'software',
        businessModel: 'services',
      },
      pipeline: {
        name: 'Ventas',
        typedStages: [
          { name: 'Nuevo lead', type: 'OPEN' },
          { name: 'Descubrimiento', type: 'OPEN' },
          { name: 'Propuesta', type: 'OPEN' },
          { name: 'Negociación', type: 'OPEN' },
          { name: 'Cerrado ganado', type: 'WON' },
          { name: 'Cerrado perdido', type: 'LOST' },
        ],
        templateKey: 'software',
      },
    });
    expect(res.status).toBe(201);
    const cfg = await configuracion.get(res.body.company.id);
    expect(cfg.identity.businessModel).toBe('services');
    expect(cfg.regional.currency).toBe('MXN');
    expect(cfg.catalog.categories).toEqual([
      'Implementación',
      'Consultoría',
      'Soporte',
      'Licencias',
    ]);
    expect(cfg.pipeline?.stages[1].name).toBe('Descubrimiento');
    expect(JSON.stringify(cfg)).not.toMatch(/salas|comedor|sillas|tehus/i);
  });

  it('empresa genérica («Otro»): guarda la descripción manual, sin catálogo no guarda categorías, pipeline propio', async () => {
    const { res } = await crear({
      company: {
        name: `${PREFIJO} Otro`,
        businessType: '  Distribuidora de   insumos ',
      },
      commercial: {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: false,
        usesQuotes: false,
        usesTasks: true,
        categories: ['Salas'],
        industry: 'generic',
        businessType: 'other',
        businessModel: 'products',
      },
      pipeline: {
        name: 'Ventas',
        typedStages: [
          { name: 'Nuevo lead', type: 'OPEN' },
          { name: 'Contactado', type: 'OPEN' },
          { name: 'Propuesta', type: 'OPEN' },
          { name: 'Seguimiento', type: 'OPEN' },
          { name: 'Cerrado ganado', type: 'WON' },
          { name: 'Cerrado perdido', type: 'LOST' },
        ],
        templateKey: 'other',
      },
    });
    expect(res.status).toBe(201);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: res.body.company.id },
    });
    expect(company.businessType).toBe('Distribuidora de insumos');
    // Sin región enviada → defaults de columna.
    expect([company.timezone, company.currency, company.locale]).toEqual([
      'America/Bogota',
      'COP',
      'es-CO',
    ]);
    const cfg = await configuracion.get(company.id);
    expect(cfg.catalog.categories).toEqual([]);
    expect(cfg.modules.catalog).toBe(false);
    expect(cfg.identity.industry).toBe('generic');
  });

  it('un código TEHUS temporal crea la empresa y queda USED; el segundo intento con el mismo código es 400', async () => {
    const plain = `TEHUS-${randomGroups()}`;
    const { res, inv } = await crear(
      { company: { name: `${PREFIJO} Legacy` } },
      plain,
    );
    expect(res.status).toBe(201);
    const again = await post('/onboarding/company', plain, payload());
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/ya utilizado/);
    const row = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(row.status).toBe('USED');
    expect(
      await prisma.company.count({ where: { name: `${PREFIJO} Legacy` } }),
    ).toBe(1);
  });

  // ── concurrencia y doble clic ────────────────────────────────────────────

  it('dos peticiones simultáneas con el mismo código: exactamente una empresa, la otra 400', async () => {
    const inv = await issue();
    const before = await snapshot();
    const [a, b] = await Promise.all([
      post(
        '/onboarding/company',
        inv.plain,
        payload({ company: { name: `${PREFIJO} Carrera A` } }),
      ),
      post(
        '/onboarding/company',
        inv.plain,
        payload({ company: { name: `${PREFIJO} Carrera B` } }),
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    const winner = a.status === 201 ? a : b;
    companies.push(winner.body.company.id);
    const after = await snapshot();
    expect(after.companies).toBe(before.companies + 1);
    expect(after.users).toBe(before.users + 1);
    expect(after.pipelines).toBe(before.pipelines + 1);
    expect(
      await prisma.company.count({
        where: { name: { startsWith: `${PREFIJO} Carrera` } },
      }),
    ).toBe(1);
  });

  // ── validación y mass assignment: nada a medias ──────────────────────────

  describe('rechazos sin efectos secundarios', () => {
    const casos: Array<[string, Record<string, any>, number, RegExp]> = [
      [
        'companyId en el cuerpo',
        { companyId: 'otra-empresa' },
        400,
        /companyId/,
      ],
      [
        'companyId anidado en company',
        { company: { companyId: 'otra' } },
        400,
        /companyId/,
      ],
      [
        'rol privilegiado en asesor',
        {
          agents: [
            {
              name: 'X',
              email: 'e2e-onb3-x@example.test',
              password: PASSWORD,
              role: 'SUPER_ADMIN',
            },
          ],
        },
        400,
        /AGENT/,
      ],
      [
        'rol en admin',
        {
          admin: {
            name: 'A',
            email: 'e2e-onb3-y@example.test',
            password: PASSWORD,
            role: 'SUPER_ADMIN',
          },
        },
        400,
        /role/,
      ],
      ['campo desconocido', { plan: 'enterprise' }, 400, /plan/],
      [
        'status interno',
        { company: { status: 'ACTIVE', isDemo: true } },
        400,
        /status|isDemo/,
      ],
      [
        'pipeline sin etapa abierta',
        {
          pipeline: {
            typedStages: [
              { name: 'G', type: 'WON' },
              { name: 'P', type: 'LOST' },
            ],
          },
        },
        400,
        /abierta/,
      ],
      [
        'pipeline sin cierre ganado',
        {
          pipeline: {
            typedStages: [
              { name: 'A', type: 'OPEN' },
              { name: 'P', type: 'LOST' },
            ],
          },
        },
        400,
        /ganado/,
      ],
      [
        'pipeline sin cierre perdido',
        {
          pipeline: {
            typedStages: [
              { name: 'A', type: 'OPEN' },
              { name: 'G', type: 'WON' },
            ],
          },
        },
        400,
        /perdido/,
      ],
      [
        'etapas duplicadas',
        {
          pipeline: {
            typedStages: [
              { name: 'Nuevo', type: 'OPEN' },
              { name: ' nuevo ', type: 'OPEN' },
              { name: 'G', type: 'WON' },
              { name: 'P', type: 'LOST' },
            ],
          },
        },
        400,
        /repetida/,
      ],
      [
        'industria desconocida',
        { commercial: { industry: 'astrology', businessType: 'x' } },
        400,
        /industria/,
      ],
      [
        'tipo que no pertenece a la industria',
        {
          commercial: { industry: 'veterinary_pet', businessType: 'showroom' },
        },
        400,
        /pertenece/,
      ],
      [
        'modelo comercial inválido',
        { commercial: { businessModel: 'both' } },
        400,
        /businessModel/,
      ],
      [
        'zona horaria inválida',
        { company: { timezone: 'Bogota' } },
        400,
        /IANA/,
      ],
      [
        'moneda inválida',
        { company: { currency: 'PESOS' } },
        400,
        /currency|ISO/,
      ],
      [
        'idioma inválido',
        { company: { locale: 'castellano' } },
        400,
        /idioma|locale/,
      ],
      [
        'contraseña débil',
        {
          admin: {
            name: 'A',
            email: 'e2e-onb3-w@example.test',
            password: 'abc',
          },
        },
        400,
        /contraseña/i,
      ],
      [
        '«Otro» sin descripción',
        {
          commercial: { industry: 'generic', businessType: 'other' },
          company: { name: `${PREFIJO} Sin desc` },
        },
        400,
        /Describe tu tipo de negocio/,
      ],
      [
        'categoría demasiado larga',
        { commercial: { categories: ['x'.repeat(61)] } },
        400,
        /60 caracteres/,
      ],
    ];

    it.each(casos)(
      '%s → %i y el código sigue ACTIVE sin empresa ni usuarios nuevos',
      async (_n, over, status, re) => {
        const inv = await issue();
        const before = await snapshot();
        const res = await post('/onboarding/company', inv.plain, payload(over));
        expect(res.status).toBe(status);
        expect(JSON.stringify(res.body.message)).toMatch(re);
        expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
        const after = await snapshot();
        expect(after).toEqual(before);
        const row = await prisma.invitationCode.findUniqueOrThrow({
          where: { id: inv.id },
        });
        expect(row.status).toBe('ACTIVE');
      },
    );

    it('email ya registrado → 409, código intacto', async () => {
      const inv = await issue();
      const existing = (await prisma.user.findFirst({
        where: { email: { startsWith: 'e2e-onb3-admin-' } },
      }))!;
      const before = await snapshot();
      const res = await post(
        '/onboarding/company',
        inv.plain,
        payload({
          admin: { name: 'Dup', email: existing.email, password: PASSWORD },
        }),
      );
      expect(res.status).toBe(409);
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await prisma.invitationCode.findUniqueOrThrow({
            where: { id: inv.id },
          })
        ).status,
      ).toBe('ACTIVE');
    });

    it('emails repetidos dentro de la misma petición → 409', async () => {
      const inv = await issue();
      const email = `e2e-onb3-rep-${Date.now()}@example.test`;
      const res = await post(
        '/onboarding/company',
        inv.plain,
        payload({
          admin: { name: 'A', email, password: PASSWORD },
          agents: [{ name: 'B', email, password: PASSWORD, role: 'AGENT' }],
        }),
      );
      expect(res.status).toBe(409);
      expect(
        (
          await prisma.invitationCode.findUniqueOrThrow({
            where: { id: inv.id },
          })
        ).status,
      ).toBe('ACTIVE');
    });

    it('categorías duplicadas (mayúsculas/espacios) se normalizan a una sola', async () => {
      const { res } = await crear({
        commercial: {
          categories: ['Salas', ' salas ', 'SALAS', 'Comedores'],
          industry: 'furniture_decor',
          businessType: 'showroom',
          businessModel: 'mixed',
          sellsServices: true,
        },
      });
      expect(res.status).toBe(201);
      const cfg = await configuracion.get(res.body.company.id);
      expect(cfg.catalog.categories).toEqual(['Salas', 'Comedores']);
    });
  });

  // ── aislamiento ──────────────────────────────────────────────────────────

  it('cada empresa creada ve solo su configuración: categorías y pipeline no se cruzan', async () => {
    const [muebles, vet] = await Promise.all(
      [`${PREFIJO} Muebles`, `${PREFIJO} Vet`].map((name) =>
        prisma.company.findFirstOrThrow({ where: { name } }),
      ),
    );
    const a = await configuracion.get(muebles.id);
    const b = await configuracion.get(vet.id);
    expect(a.catalog.categories).toContain('Salas');
    expect(b.catalog.categories).not.toContain('Salas');
    expect(a.pipeline?.id).not.toBe(b.pipeline?.id);
    expect(a.regional.currency).toBe('COP');
    expect(b.regional.currency).toBe('CRC');
    const usersA = await prisma.user.findMany({
      where: { companyId: muebles.id },
    });
    expect(usersA.every((u) => u.companyId === muebles.id)).toBe(true);
    const pipelinesVet = await prisma.pipeline.findMany({
      where: { companyId: vet.id },
    });
    expect(pipelinesVet).toHaveLength(1);
  });
});

function randomGroups(): string {
  const hex = () =>
    Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `${hex()}-${hex()}-${hex()}-${hex()}`;
}
