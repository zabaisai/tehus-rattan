import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CompaniesController } from '../src/modules/companies/companies.controller';
import { CompaniesService } from '../src/modules/companies/companies.service';
import { CompanyBrandingService } from '../src/modules/companies/company-branding.service';
import { TenantConfigurationService } from '../src/modules/companies/tenant-configuration.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { ProductsController } from '../src/modules/products/products.controller';
import { ProductsService } from '../src/modules/products/products.service';
import { ImportacionDeProductosService } from '../src/modules/products/import/importacion.service';
import { ImportacionQueue } from '../src/modules/products/import/importacion.queue';
import { LeadProductsController } from '../src/modules/leads/lead-products.controller';
import { LeadProductsService } from '../src/modules/leads/lead-products.service';
import { TasksController } from '../src/modules/tasks/tasks.controller';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { RealtimeEmitter } from '../src/common/realtime/realtime.emitter';
import { QuotesController } from '../src/modules/quotes/quotes.controller';
import { QuotesService } from '../src/modules/quotes/quotes.service';
import { QuotePdfService } from '../src/modules/quotes/quote-pdf.service';
import { QuoteCicloService } from '../src/modules/quotes/quote-ciclo.service';
import { SearchController } from '../src/modules/search/search.controller';
import { SearchService } from '../src/modules/search/search.service';
import {
  crearAppHttp,
  crearEmpresaE2E,
  limpiarEmpresasE2E,
  tokenDe,
  type EmpresaE2E,
} from './helpers/tenant-http';

/**
 * FASE 4 — capacidades por empresa, de extremo a extremo por HTTP.
 *
 * Con la aplicación real (guards, ValidationPipe con whitelist, motor de
 * configuración, controladores de productos, tareas, cotizaciones, elementos
 * de oportunidad y búsqueda) sobre PostgreSQL. Empresas temporales
 * `E2E-CAP4-*`, borradas por id al final. Sin datos ni empresas reales.
 */
const PREFIJO = 'E2E-CAP4';

describe('Fase 4 — capacidades efectivas y guard de módulo (HTTP)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let jwt: JwtService;
  const empresas: EmpresaE2E[] = [];

  /** Solo servicios, con catálogo y cotizaciones, SIN tareas (v2). */
  let A: EmpresaE2E;
  /** Legacy v0: sin settings, con productos y tareas reales. */
  let B: EmpresaE2E;
  /** v1 con catálogo desactivado y cotizaciones activas (plantilla de servicios). */
  let C: EmpresaE2E;
  /** Solo productos (v2). */
  let D: EmpresaE2E;

  let leadC: string;
  let contactoC: string;
  const productosB: string[] = [];
  const tareasB: string[] = [];

  const auth = (e: EmpresaE2E, rol: 'admin' | 'agent' = 'admin') =>
    `Bearer ${tokenDe(jwt, e, rol)}`;

  beforeAll(async () => {
    await prisma.$connect();
    ({ app, jwt } = await crearAppHttp({
      prisma,
      controllers: [
        CompaniesController,
        ProductsController,
        LeadProductsController,
        TasksController,
        QuotesController,
        SearchController,
      ],
      providers: [
        CompaniesService,
        TenantConfigurationService,
        PlatformAuditLogService,
        {
          provide: CompanyBrandingService,
          useValue: { uploadLogo: jest.fn() },
        },
        ProductsService,
        { provide: ImportacionDeProductosService, useValue: {} },
        { provide: ImportacionQueue, useValue: { encolar: jest.fn() } },
        LeadProductsService,
        TasksService,
        { provide: RealtimeEmitter, useValue: { taskUpdated: jest.fn() } },
        QuotesService,
        QuoteCicloService,
        { provide: QuotePdfService, useValue: {} },
        SearchService,
      ],
    }));

    A = await crearEmpresaE2E(prisma, PREFIJO, {
      settings: {
        version: 2,
        commercial: {
          sellsProducts: false,
          sellsServices: true,
          usesCatalog: true,
          usesQuotes: true,
          usesTasks: false,
        },
        catalog: {
          categories: ['Consultoría', 'Soporte'],
          allowFreeText: true,
        },
      },
    });
    B = await crearEmpresaE2E(prisma, PREFIJO);
    C = await crearEmpresaE2E(prisma, PREFIJO, {
      settings: {
        sellsProducts: false,
        sellsServices: true,
        usesCatalog: false,
        usesQuotes: true,
        usesTasks: true,
        categories: [],
      },
    });
    D = await crearEmpresaE2E(prisma, PREFIJO, {
      settings: {
        version: 2,
        commercial: {
          sellsProducts: true,
          sellsServices: false,
          usesCatalog: true,
          usesQuotes: false,
          usesTasks: true,
        },
        catalog: { categories: ['Sillas'], allowFreeText: true },
      },
    });
    empresas.push(A, B, C, D);

    // Datos reales de la empresa legacy: productos (uno con itemType NULL) y tareas.
    for (const [name, itemType] of [
      ['Producto legacy', null],
      ['Servicio legacy', 'SERVICE'],
    ] as const) {
      const p = await prisma.product.create({
        data: { name, price: 10, companyId: B.companyId, itemType },
      });
      productosB.push(p.id);
    }
    for (const title of ['Llamar', 'Enviar propuesta']) {
      const t = await prisma.task.create({
        data: { title, companyId: B.companyId },
      });
      tareasB.push(t.id);
    }

    // Una oportunidad en C para probar `leads/:id/products` sin catálogo.
    const pipeline = await prisma.pipeline.create({
      data: {
        name: 'Ventas',
        isDefault: true,
        companyId: C.companyId,
        stages: { create: { name: 'Nuevo', order: 0, isInitial: true } },
      },
      include: { stages: true },
    });
    const contacto = await prisma.contact.create({
      data: { phone: `+5730000${Date.now() % 100000}`, companyId: C.companyId },
    });
    contactoC = contacto.id;
    const lead = await prisma.lead.create({
      data: {
        title: 'Oportunidad C',
        companyId: C.companyId,
        contactId: contacto.id,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
      },
    });
    leadC = lead.id;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { companyId: { in: empresas.map((e) => e.companyId) } },
    });
    if (leadC) await prisma.lead.deleteMany({ where: { id: leadC } });
    if (contactoC)
      await prisma.contact.deleteMany({ where: { id: contactoC } });
    await limpiarEmpresasE2E(prisma, empresas);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('configuración efectiva', () => {
    it('una empresa legacy (v0) conserva catálogo, cotizaciones y tareas, y lo dice', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(B))
        .expect(200);
      expect(r.body.storageVersion).toBe(0);
      expect(r.body.modules).toMatchObject({
        catalog: true,
        quotes: true,
        tasks: true,
      });
      expect(r.body.capabilities.legacyDefaultsApplied).toEqual([
        'catalog',
        'quotes',
        'tasks',
      ]);
      expect(r.body.capabilities.definitions).toHaveLength(7);
    });

    it('el modelo comercial fija los tipos de catálogo que se pueden crear', async () => {
      const a = await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(A, 'agent'))
        .expect(200);
      expect(a.body.capabilities.catalog).toEqual({
        allowedItemTypes: ['SERVICE'],
        defaultItemType: 'SERVICE',
      });
      const d = await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(D))
        .expect(200);
      expect(d.body.capabilities.catalog).toEqual({
        allowedItemTypes: ['PRODUCT'],
        defaultItemType: 'PRODUCT',
      });
    });
  });

  describe('guard de módulo', () => {
    it('sin tareas: la API de tareas responde 403 MODULE_DISABLED a ADMIN y AGENT', async () => {
      for (const rol of ['admin', 'agent'] as const) {
        const r = await request(app.getHttpServer())
          .get('/api/tasks')
          .set('Authorization', auth(A, rol))
          .expect(403);
        expect(r.body).toMatchObject({
          code: 'MODULE_DISABLED',
          module: 'tasks',
        });
        expect(JSON.stringify(r.body)).not.toMatch(/companyId|E2E-CAP4/);
      }
      await request(app.getHttpServer())
        .post('/api/tasks')
        .set('Authorization', auth(A))
        .send({ title: 'No debería crearse' })
        .expect(403);
      expect(
        await prisma.task.count({ where: { companyId: A.companyId } }),
      ).toBe(0);
    });

    it('la configuración sigue accesible con el módulo desactivado (para reactivarlo)', async () => {
      await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(A, 'agent'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/companies/me/settings')
        .set('Authorization', auth(A))
        .expect(200);
    });

    it('sin catálogo: productos y elementos de oportunidad se bloquean; cotizaciones no', async () => {
      const p = await request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', auth(C))
        .expect(403);
      expect(p.body).toMatchObject({
        code: 'MODULE_DISABLED',
        module: 'catalog',
      });

      const lp = await request(app.getHttpServer())
        .post(`/api/leads/${leadC}/products`)
        .set('Authorization', auth(C))
        .send({ productId: 'cualquiera' })
        .expect(403);
      expect(lp.body.module).toBe('catalog');

      await request(app.getHttpServer())
        .get('/api/quotes')
        .set('Authorization', auth(C, 'agent'))
        .expect(200);
    });

    it('la búsqueda omite los tipos de módulos desactivados aunque se pidan', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'legacy', tipos: ['productos', 'contactos'] })
        .set('Authorization', auth(C))
        .expect(200);
      expect(r.body.grupos.map((g: any) => g.tipo)).not.toContain('productos');

      const b = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'legacy', tipos: ['productos'] })
        .set('Authorization', auth(B))
        .expect(200);
      expect(
        b.body.grupos.find((g: any) => g.tipo === 'productos')?.total,
      ).toBe(2);
    });
  });

  describe('desactivar no borra; reactivar recupera', () => {
    it('ADMIN desactiva el catálogo de la empresa legacy: la API se bloquea al instante y los datos siguen', async () => {
      const antes = await prisma.product.count({
        where: { companyId: B.companyId },
      });
      expect(antes).toBe(2);

      const patch = await request(app.getHttpServer())
        .patch('/api/companies/me/configuration')
        .set('Authorization', auth(B))
        .send({ modules: { catalog: false } })
        .expect(200);
      // Solo cambia lo pedido: cotizaciones y tareas siguen activas.
      expect(patch.body.modules).toMatchObject({
        catalog: false,
        quotes: true,
        tasks: true,
      });
      expect(patch.body.capabilities.legacyDefaultsApplied).toEqual([]);

      const bloqueado = await request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', auth(B, 'agent'))
        .expect(403);
      expect(bloqueado.body.code).toBe('MODULE_DISABLED');

      expect(
        await prisma.product.count({ where: { companyId: B.companyId } }),
      ).toBe(2);
      expect(
        await prisma.task.count({ where: { companyId: B.companyId } }),
      ).toBe(2);
    });

    it('al reactivarlo, los mismos productos vuelven (la fila NULL sigue leyéndose como PRODUCT)', async () => {
      await request(app.getHttpServer())
        .patch('/api/companies/me/configuration')
        .set('Authorization', auth(B))
        .send({ modules: { catalog: true } })
        .expect(200);
      const r = await request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', auth(B, 'agent'))
        .expect(200);
      expect(r.body.map((p: any) => p.id).sort()).toEqual(
        [...productosB].sort(),
      );
      expect(r.body.every((p: any) => p.itemType !== null)).toBe(true);
    });

    it('AGENT no puede activar ni desactivar módulos', async () => {
      await request(app.getHttpServer())
        .patch('/api/companies/me/configuration')
        .set('Authorization', auth(B, 'agent'))
        .send({ modules: { tasks: false } })
        .expect(403);
      const r = await request(app.getHttpServer())
        .get('/api/tasks')
        .set('Authorization', auth(B, 'agent'))
        .expect(200);
      expect(r.body.length ?? r.body.items?.length).toBeDefined();
    });

    it('companyId en el cuerpo y claves desconocidas se rechazan con 400 sin efectos', async () => {
      await request(app.getHttpServer())
        .patch('/api/companies/me/configuration')
        .set('Authorization', auth(B))
        .send({ companyId: A.companyId, modules: { tasks: false } })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/companies/me/configuration')
        .set('Authorization', auth(B))
        .send({ modules: { billing: true } })
        .expect(400);
      const r = await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(B))
        .expect(200);
      expect(r.body.modules.tasks).toBe(true);
    });
  });

  describe('tipo de elemento según el modelo comercial', () => {
    it('«solo servicios»: omitir el tipo crea SERVICE y PRODUCT se rechaza con motivo', async () => {
      const ok = await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', auth(A))
        .send({ name: 'Implementación', price: 100 })
        .expect(201);
      expect(ok.body.itemType).toBe('SERVICE');

      const mal = await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', auth(A))
        .send({ name: 'Silla', price: 100, itemType: 'PRODUCT' })
        .expect(400);
      expect(mal.body.message).toMatch(/solo servicios/);
      expect(
        await prisma.product.count({
          where: { companyId: A.companyId, itemType: 'PRODUCT' },
        }),
      ).toBe(0);
    });

    it('«solo productos»: SERVICE se rechaza; `itemType: null` sigue siendo inválido', async () => {
      await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', auth(D))
        .send({ name: 'Armado', price: 10, itemType: 'SERVICE' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', auth(D))
        .send({ name: 'Silla', price: 10, itemType: null })
        .expect(400);
      const ok = await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', auth(D))
        .send({ name: 'Silla', price: 10, category: 'Sillas' })
        .expect(201);
      expect(ok.body.itemType).toBe('PRODUCT');
    });

    it('un elemento heredado del otro tipo se lee, se edita y no se convierte', async () => {
      const heredado = await prisma.product.create({
        data: {
          name: 'Producto heredado',
          price: 5,
          companyId: A.companyId,
          itemType: null,
        },
      });
      const lista = await request(app.getHttpServer())
        .get('/api/products')
        .set('Authorization', auth(A, 'agent'))
        .expect(200);
      const fila = lista.body.find((p: any) => p.id === heredado.id);
      expect(fila.itemType).toBe('PRODUCT');

      await request(app.getHttpServer())
        .patch(`/api/products/${heredado.id}`)
        .set('Authorization', auth(A))
        .send({ price: 7 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/products/${heredado.id}`)
        .set('Authorization', auth(A))
        .send({ itemType: 'PRODUCT' })
        .expect(400);
      const enBase = await prisma.product.findUnique({
        where: { id: heredado.id },
      });
      expect(enBase?.itemType).toBeNull();
      expect(Number(enBase?.price)).toBe(7);
    });
  });

  describe('aislamiento', () => {
    it('un producto de otra empresa es 404 aunque el módulo esté activo', async () => {
      await request(app.getHttpServer())
        .get(`/api/products/${productosB[0]}`)
        .set('Authorization', auth(A))
        .expect(404);
    });

    it('cambiar la configuración de una empresa no altera la de otra (ni su caché)', async () => {
      const cAntes = await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(C))
        .expect(200);
      await request(app.getHttpServer())
        .patch('/api/companies/me/configuration')
        .set('Authorization', auth(D))
        .send({ modules: { tasks: false } })
        .expect(200);
      const cDespues = await request(app.getHttpServer())
        .get('/api/companies/me/configuration')
        .set('Authorization', auth(C))
        .expect(200);
      expect(cDespues.body.modules).toEqual(cAntes.body.modules);
      await request(app.getHttpServer())
        .get('/api/tasks')
        .set('Authorization', auth(C, 'agent'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/tasks')
        .set('Authorization', auth(D, 'agent'))
        .expect(403);
    });
  });
});
