import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantConfigurationService } from '../src/modules/companies/tenant-configuration.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { ProductsController } from '../src/modules/products/products.controller';
import { ProductsService } from '../src/modules/products/products.service';
import { ImportacionDeProductosService } from '../src/modules/products/import/importacion.service';
import { ImportacionQueue } from '../src/modules/products/import/importacion.queue';
import { LeadProductsService } from '../src/modules/leads/lead-products.service';
import {
  crearAppHttp,
  crearEmpresaE2E,
  EmpresaE2E,
  limpiarEmpresasE2E,
  tokenDe,
} from './helpers/tenant-http';

/**
 * PRODUCT / SERVICE — HTTP real, base real.
 *
 * Incluye lo que solo la base demuestra: una fila anterior a la migración
 * (`itemType` NULL, simulada con SQL directo) se responde como PRODUCT y entra
 * en el filtro PRODUCT; el default de columna cubre a un cliente antiguo; el id
 * de otro tenant es un 404 genérico.
 *
 * Datos con prefijo E2E-TIPO, borrados al final por ID exacto.
 */
const PREFIJO = 'E2E-TIPO';
const prisma = new PrismaService();

describe('Catálogo: tipo de elemento (e2e, HTTP + base real)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const empresas: EmpresaE2E[] = [];
  let A: EmpresaE2E;
  let B: EmpresaE2E;

  beforeAll(async () => {
    await prisma.$connect();
    ({ app, jwt } = await crearAppHttp({
      prisma,
      controllers: [ProductsController],
      providers: [
        ProductsService,
        TenantConfigurationService,
        PlatformAuditLogService,
        { provide: ImportacionDeProductosService, useValue: {} },
        { provide: ImportacionQueue, useValue: { encolar: jest.fn() } },
      ],
    }));
    A = await crearEmpresaE2E(prisma, PREFIJO);
    B = await crearEmpresaE2E(prisma, PREFIJO);
    empresas.push(A, B);
  });

  afterAll(async () => {
    await limpiarEmpresasE2E(prisma, empresas);
    await app?.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = (e: EmpresaE2E, quien: 'admin' | 'agent' = 'admin') =>
    `Bearer ${tokenDe(jwt, e, quien)}`;

  let productoExplicito: string;
  let servicio: string;
  let clienteAntiguo: string;
  let legacyNull: string;

  it('crea PRODUCT explícito, SERVICE explícito y PRODUCT por omisión (cliente antiguo)', async () => {
    const p = await http()
      .post('/api/products')
      .set('Authorization', auth(A))
      .send({
        name: 'Silla',
        price: 100,
        itemType: 'PRODUCT',
        sku: 'S-1',
        stock: 4,
      });
    expect(p.status).toBe(201);
    expect(p.body.itemType).toBe('PRODUCT');
    productoExplicito = p.body.id;

    const s = await http()
      .post('/api/products')
      .set('Authorization', auth(A))
      .send({
        name: 'Consulta',
        price: 50,
        itemType: 'SERVICE',
        category: 'Servicios',
      });
    expect(s.status).toBe(201);
    expect(s.body.itemType).toBe('SERVICE');
    expect(s.body.stock).toBeNull();
    servicio = s.body.id;

    const viejo = await http()
      .post('/api/products')
      .set('Authorization', auth(A))
      .send({ name: 'Mesa', price: 200 });
    expect(viejo.status).toBe(201);
    expect(viejo.body.itemType).toBe('PRODUCT');
    clienteAntiguo = viejo.body.id;

    const filas = await prisma.product.findMany({
      where: { companyId: A.companyId },
      select: { id: true, itemType: true },
    });
    // Ninguna fila NUEVA queda en NULL.
    expect(filas.every((f) => f.itemType !== null)).toBe(true);
  });

  it('una fila anterior a la Fase 2 (itemType NULL en la base) se responde como PRODUCT', async () => {
    const creado = await http()
      .post('/api/products')
      .set('Authorization', auth(A))
      .send({ name: 'Lámpara antigua', price: 30, sku: 'L-OLD' });
    legacyNull = creado.body.id;
    // Simula el estado que deja la migración sobre los productos existentes.
    await prisma.$executeRaw`UPDATE "products" SET "itemType" = NULL WHERE "id" = ${legacyNull}`;
    const raw = await prisma.product.findUniqueOrThrow({
      where: { id: legacyNull },
      select: { itemType: true },
    });
    expect(raw.itemType).toBeNull();

    const res = await http()
      .get(`/api/products/${legacyNull}`)
      .set('Authorization', auth(A, 'agent'));
    expect(res.status).toBe(200);
    expect(res.body.itemType).toBe('PRODUCT');
  });

  it('filtro por tipo: PRODUCT incluye los legacy NULL; SERVICE solo servicios; sin filtro todo', async () => {
    const todos = await http()
      .get('/api/products')
      .set('Authorization', auth(A, 'agent'));
    expect(todos.status).toBe(200);
    expect(todos.body.map((p: any) => p.id).sort()).toEqual(
      [productoExplicito, servicio, clienteAntiguo, legacyNull].sort(),
    );
    expect(
      todos.body.every(
        (p: any) => p.itemType === 'PRODUCT' || p.itemType === 'SERVICE',
      ),
    ).toBe(true);

    const productos = await http()
      .get('/api/products?itemType=PRODUCT')
      .set('Authorization', auth(A, 'agent'));
    expect(productos.body.map((p: any) => p.id).sort()).toEqual(
      [productoExplicito, clienteAntiguo, legacyNull].sort(),
    );

    const servicios = await http()
      .get('/api/products?itemType=SERVICE')
      .set('Authorization', auth(A, 'agent'));
    expect(servicios.body.map((p: any) => p.id)).toEqual([servicio]);

    // Convive con el filtro de categoría.
    const porCategoria = await http()
      .get('/api/products?itemType=SERVICE&category=Servicios')
      .set('Authorization', auth(A, 'agent'));
    expect(porCategoria.body).toHaveLength(1);
  });

  it('tipo inválido en el filtro o en el cuerpo → 400', async () => {
    expect(
      (
        await http()
          .get('/api/products?itemType=OTRO')
          .set('Authorization', auth(A))
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .get('/api/products?itemType=service')
          .set('Authorization', auth(A))
      ).status,
    ).toBe(400);
    const crear = await http()
      .post('/api/products')
      .set('Authorization', auth(A))
      .send({ name: 'X', price: 1, itemType: 'BIEN' });
    expect(crear.status).toBe(400);
    expect(JSON.stringify(crear.body)).toContain(
      'itemType debe ser PRODUCT o SERVICE',
    );
    const editar = await http()
      .patch(`/api/products/${productoExplicito}`)
      .set('Authorization', auth(A))
      .send({ itemType: null });
    expect(editar.status).toBe(400);
  });

  it('editar el tipo no borra stock ni SKU', async () => {
    const res = await http()
      .patch(`/api/products/${productoExplicito}`)
      .set('Authorization', auth(A))
      .send({ itemType: 'SERVICE' });
    expect(res.status).toBe(200);
    expect(res.body.itemType).toBe('SERVICE');
    expect(res.body.sku).toBe('S-1');
    expect(res.body.stock).toBe(4);
    // Y vuelta.
    const back = await http()
      .patch(`/api/products/${productoExplicito}`)
      .set('Authorization', auth(A))
      .send({ itemType: 'PRODUCT' });
    expect(back.body.itemType).toBe('PRODUCT');
  });

  it('AGENT lee pero no crea ni edita (403)', async () => {
    expect(
      (
        await http()
          .post('/api/products')
          .set('Authorization', auth(A, 'agent'))
          .send({ name: 'X', price: 1, itemType: 'SERVICE' })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .patch(`/api/products/${servicio}`)
          .set('Authorization', auth(A, 'agent'))
          .send({ itemType: 'PRODUCT' })
      ).status,
    ).toBe(403);
  });

  it('el id de un producto de otro tenant es un 404 genérico en GET, PATCH y DELETE; B no ve nada de A', async () => {
    const get = await http()
      .get(`/api/products/${servicio}`)
      .set('Authorization', auth(B));
    expect(get.status).toBe(404);
    expect(get.body.message).toBe('Producto no encontrado');
    const patch = await http()
      .patch(`/api/products/${servicio}`)
      .set('Authorization', auth(B))
      .send({ itemType: 'PRODUCT' });
    expect(patch.status).toBe(404);
    const del = await http()
      .delete(`/api/products/${servicio}`)
      .set('Authorization', auth(B));
    expect(del.status).toBe(404);
    const lista = await http()
      .get('/api/products?itemType=SERVICE')
      .set('Authorization', auth(B));
    expect(lista.body).toEqual([]);
    // Nada cambió en A.
    const raw = await prisma.product.findUniqueOrThrow({
      where: { id: servicio },
      select: { itemType: true, isActive: true },
    });
    expect(raw).toEqual({ itemType: 'SERVICE', isActive: true });
  });

  it('los productos de una oportunidad exponen el tipo efectivo (legacy NULL → PRODUCT)', async () => {
    const leadProducts = new LeadProductsService(prisma);
    // Un lead mínimo de A: pipeline + etapa + contacto.
    const pipeline = await prisma.pipeline.create({
      data: {
        companyId: A.companyId,
        name: 'Ventas',
        isDefault: true,
        stages: {
          create: [{ name: 'Nuevo', order: 0, type: 'OPEN', isInitial: true }],
        },
      },
      include: { stages: true },
    });
    const contact = await prisma.contact.create({
      data: {
        companyId: A.companyId,
        phone: `+57300${Date.now() % 10_000_000}`,
        name: `${PREFIJO} Contacto`,
      },
      select: { id: true },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: A.companyId,
        title: `${PREFIJO} Lead`,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
      },
      select: { id: true },
    });
    try {
      const a = await leadProducts.addProduct(lead.id, A.companyId, {
        productId: legacyNull,
        quantity: 1,
      });
      expect(a.product.itemType).toBe('PRODUCT');
      const b = await leadProducts.addProduct(lead.id, A.companyId, {
        productId: servicio,
        quantity: 2,
      });
      expect(b.product.itemType).toBe('SERVICE');
      const lista = await leadProducts.findAllForLead(lead.id, A.companyId);
      expect(lista.map((x: any) => x.product.itemType).sort()).toEqual([
        'PRODUCT',
        'SERVICE',
      ]);
    } finally {
      await prisma.leadProduct.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contact.id } });
    }
  });
});
