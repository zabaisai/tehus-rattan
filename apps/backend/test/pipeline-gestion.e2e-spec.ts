import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PipelineController } from '../src/modules/pipeline/pipeline.controller';
import { PipelineService } from '../src/modules/pipeline/pipeline.service';
import { PipelineRetiroService } from '../src/modules/pipeline/pipeline-retiro.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import {
  crearAppHttp,
  crearEmpresaE2E,
  limpiarEmpresasE2E,
  tokenDe,
  type EmpresaE2E,
} from './helpers/tenant-http';

/**
 * FASE 4 — gestión segura de pipelines por HTTP contra PostgreSQL real:
 * invariantes de etapas, orden completo, concurrencia (bloqueo de fila e
 * índice parcial del predeterminado), roles y auditoría sin datos sensibles.
 * Empresas temporales `E2E-PIPE4-*`, borradas por id al final.
 */
const PREFIJO = 'E2E-PIPE4';

describe('Fase 4 — gestión de pipelines (HTTP)', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let jwt: JwtService;
  const empresas: EmpresaE2E[] = [];
  let A: EmpresaE2E;
  let B: EmpresaE2E;
  /** Pipeline predeterminado de A con 4 etapas (2 OPEN, 1 WON, 1 LOST). */
  let ventas: {
    id: string;
    stages: { id: string; type: string; name: string }[];
  };
  let contactoA: string;
  let leadA: string;

  const auth = (e: EmpresaE2E, rol: 'admin' | 'agent' = 'admin') =>
    `Bearer ${tokenDe(jwt, e, rol)}`;

  const etapa = (type: string) => ventas.stages.find((s) => s.type === type)!;

  beforeAll(async () => {
    await prisma.$connect();
    ({ app, jwt } = await crearAppHttp({
      prisma,
      controllers: [PipelineController],
      providers: [
        PipelineService,
        PipelineRetiroService,
        PlatformAuditLogService,
      ],
    }));
    A = await crearEmpresaE2E(prisma, PREFIJO);
    B = await crearEmpresaE2E(prisma, PREFIJO);
    empresas.push(A, B);

    const creado = await prisma.pipeline.create({
      data: {
        name: 'Ventas',
        isDefault: true,
        companyId: A.companyId,
        stages: {
          create: [
            { name: 'Nuevo lead', order: 0, isInitial: true, type: 'OPEN' },
            { name: 'Propuesta', order: 1, type: 'OPEN' },
            { name: 'Ganado', order: 2, type: 'WON' },
            { name: 'Perdido', order: 3, type: 'LOST' },
          ],
        },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    ventas = creado;
    const contacto = await prisma.contact.create({
      data: { phone: `+5731000${Date.now() % 100000}`, companyId: A.companyId },
    });
    contactoA = contacto.id;
    const lead = await prisma.lead.create({
      data: {
        title: 'Con oportunidad',
        companyId: A.companyId,
        contactId: contacto.id,
        pipelineId: ventas.id,
        stageId: ventas.stages[1].id, // Propuesta
      },
    });
    leadA = lead.id;
  });

  afterAll(async () => {
    if (leadA) await prisma.lead.deleteMany({ where: { id: leadA } });
    if (contactoA)
      await prisma.contact.deleteMany({ where: { id: contactoA } });
    await limpiarEmpresasE2E(prisma, empresas);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('pipelines', () => {
    it('ADMIN crea un pipeline: nombre normalizado, entra al final y queda auditado sin valores', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', auth(A))
        .send({ name: '  Post   venta ' })
        .expect(201);
      expect(r.body.name).toBe('Post venta');
      expect(r.body.order).toBe(1);
      expect(r.body.isDefault).toBe(false);
      expect(r.body.companyId).toBe(A.companyId);

      const audit = await prisma.auditLog.findFirst({
        where: { affectedCompanyId: A.companyId, action: 'pipeline.create' },
      });
      expect(audit?.entityId).toBe(r.body.id);
      expect(JSON.stringify(audit?.metadata)).not.toContain('Post venta');
    });

    it('rechaza un nombre repetido (sin distinguir mayúsculas) y uno vacío', async () => {
      await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', auth(A))
        .send({ name: 'VENTAS' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', auth(A))
        .send({ name: '   ' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}`)
        .set('Authorization', auth(A))
        .send({ name: '' })
        .expect(400);
    });

    it('AGENT consulta pero no administra', async () => {
      await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', auth(A, 'agent'))
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', auth(A, 'agent'))
        .send({ name: 'Del agente' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/pipelines/${ventas.id}/stages`)
        .set('Authorization', auth(A, 'agent'))
        .send({ name: 'Etapa del agente' })
        .expect(403);
    });

    it('el pipeline de otra empresa es 404 en lectura y escritura', async () => {
      await request(app.getHttpServer())
        .get(`/api/pipelines/${ventas.id}`)
        .set('Authorization', auth(B))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/pipelines/${ventas.id}/stages`)
        .set('Authorization', auth(B))
        .send({ name: 'Intrusa' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}/stages/reorder`)
        .set('Authorization', auth(B))
        .send({ stages: [{ id: ventas.stages[0].id, order: 0 }] })
        .expect(404);
      expect(
        await prisma.pipelineStage.count({ where: { pipelineId: ventas.id } }),
      ).toBe(4);
    });

    it('dos peticiones simultáneas marcando predeterminados distintos dejan exactamente uno', async () => {
      const p1 = await prisma.pipeline.create({
        data: { name: 'Carrera 1', companyId: A.companyId, order: 10 },
      });
      const p2 = await prisma.pipeline.create({
        data: { name: 'Carrera 2', companyId: A.companyId, order: 11 },
      });
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/pipelines/${p1.id}`)
          .set('Authorization', auth(A))
          .send({ isDefault: true }),
        request(app.getHttpServer())
          .patch(`/api/pipelines/${p2.id}`)
          .set('Authorization', auth(A))
          .send({ isDefault: true }),
      ]);
      expect([r1.status, r2.status].every((s) => [200, 409].includes(s))).toBe(
        true,
      );
      const defaults = await prisma.pipeline.count({
        where: { companyId: A.companyId, isDefault: true },
      });
      expect(defaults).toBe(1);
      // Se restaura «Ventas» como predeterminado para el resto de pruebas.
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}`)
        .set('Authorization', auth(A))
        .send({ isDefault: true })
        .expect(200);
    });
  });

  describe('etapas', () => {
    it('no se puede crear una segunda etapa ganada ni perdida, ni un nombre repetido', async () => {
      const won = await request(app.getHttpServer())
        .post(`/api/pipelines/${ventas.id}/stages`)
        .set('Authorization', auth(A))
        .send({ name: 'Cerrado', type: 'WON' })
        .expect(400);
      expect(won.body.message).toMatch(/ya tiene una etapa ganada/);
      await request(app.getHttpServer())
        .post(`/api/pipelines/${ventas.id}/stages`)
        .set('Authorization', auth(A))
        .send({ name: 'propuesta' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/pipelines/${ventas.id}/stages`)
        .set('Authorization', auth(A))
        .send({ name: 'x'.repeat(41) })
        .expect(400);
    });

    it('sí se añade una etapa abierta más, al final, y queda auditada', async () => {
      const r = await request(app.getHttpServer())
        .post(`/api/pipelines/${ventas.id}/stages`)
        .set('Authorization', auth(A))
        .send({ name: 'Negociación' })
        .expect(201);
      expect(r.body).toMatchObject({
        type: 'OPEN',
        order: 4,
        isInitial: false,
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          affectedCompanyId: A.companyId,
          action: 'pipeline.stage.create',
        },
      });
      expect(audit?.entityId).toBe(ventas.id);
      ventas.stages.push(r.body);
    });

    it('la única etapa ganada no puede pasar a abierta ni eliminarse; la de oportunidades tampoco', async () => {
      const cambio = await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}/stages/${etapa('WON').id}`)
        .set('Authorization', auth(A))
        .send({ type: 'OPEN' })
        .expect(400);
      expect(cambio.body.message).toMatch(/única etapa ganada/);
      await request(app.getHttpServer())
        .delete(`/api/pipelines/${ventas.id}/stages/${etapa('LOST').id}`)
        .set('Authorization', auth(A))
        .expect(400);
      const conLeads = await request(app.getHttpServer())
        .delete(`/api/pipelines/${ventas.id}/stages/${ventas.stages[1].id}`)
        .set('Authorization', auth(A))
        .expect(400);
      expect(conLeads.body.message).toMatch(/1 oportunidad/);
      expect(
        await prisma.pipelineStage.count({ where: { pipelineId: ventas.id } }),
      ).toBe(5);
    });

    it('dos creaciones simultáneas de etapa perdida en un embudo sin ella: solo entra una', async () => {
      const nuevo = await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', auth(A))
        .send({ name: 'Concurrencia' })
        .expect(201);
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/pipelines/${nuevo.body.id}/stages`)
          .set('Authorization', auth(A))
          .send({ name: 'Perdido A', type: 'LOST' }),
        request(app.getHttpServer())
          .post(`/api/pipelines/${nuevo.body.id}/stages`)
          .set('Authorization', auth(A))
          .send({ name: 'Perdido B', type: 'LOST' }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 400]);
      expect(
        await prisma.pipelineStage.count({
          where: { pipelineId: nuevo.body.id, type: 'LOST' },
        }),
      ).toBe(1);
    });
  });

  describe('reordenamiento', () => {
    it('rechaza una lista parcial o con huecos y no cambia nada', async () => {
      const antes = await prisma.pipelineStage.findMany({
        where: { pipelineId: ventas.id },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}/stages/reorder`)
        .set('Authorization', auth(A))
        .send({
          stages: antes.slice(0, 2).map((s, i) => ({ id: s.id, order: i })),
        })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}/stages/reorder`)
        .set('Authorization', auth(A))
        .send({ stages: antes.map((s, i) => ({ id: s.id, order: i * 2 })) })
        .expect(400);
      const despues = await prisma.pipelineStage.findMany({
        where: { pipelineId: ventas.id },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      expect(despues).toEqual(antes);
    });

    it('aplica una permutación completa 0..n-1 y la audita', async () => {
      const actuales = await prisma.pipelineStage.findMany({
        where: { pipelineId: ventas.id },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      const invertidas = [...actuales].reverse();
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${ventas.id}/stages/reorder`)
        .set('Authorization', auth(A))
        .send({ stages: invertidas.map((s, i) => ({ id: s.id, order: i })) })
        .expect(200);
      const despues = await prisma.pipelineStage.findMany({
        where: { pipelineId: ventas.id },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      expect(despues.map((s) => s.id)).toEqual(invertidas.map((s) => s.id));
      expect(despues.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
      const audit = await prisma.auditLog.findFirst({
        where: {
          affectedCompanyId: A.companyId,
          action: 'pipeline.stages.reorder',
        },
      });
      expect(audit?.metadata).toEqual({ etapas: 5 });
    });
  });
});
