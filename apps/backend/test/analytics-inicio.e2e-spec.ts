import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';

// Habla con un Postgres REAL, como `search-tenant-isolation.e2e-spec.ts`.
// Con un Prisma simulado la prueba solo demostraría que se escribió
// `companyId` en el `where`; aquí demuestra que la base no devuelve la fila de
// la otra empresa, que es lo que importa cuando dos empresas tienen datos
// idénticos.
//
// Requiere `docker compose up -d postgres` con el esquema migrado.
describe('AnalyticsService — Inicio (e2e, base real)', () => {
  let prisma: PrismaService;
  let service: AnalyticsService;

  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let leadGanadaA: string;
  let leadGanadaB: string;

  const AYER = new Date();
  AYER.setDate(AYER.getDate() - 1);
  AYER.setHours(10, 0, 0, 0);

  function clave(fecha: Date): string {
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AnalyticsService(prisma);

    const [a, b] = await Promise.all([
      prisma.company.create({ data: { name: 'E2E Inicio Co A' } }),
      prisma.company.create({ data: { name: 'E2E Inicio Co B' } }),
    ]);
    empresaA = a.id;
    empresaB = b.id;

    const ua = await prisma.user.create({
      data: {
        companyId: empresaA,
        email: `e2e-inicio-${a.id}@qa.invalid`,
        name: 'E2E Inicio Asesora',
        password: 'no-se-usa-en-esta-prueba',
        role: 'ADMIN',
      },
    });
    usuarioA = ua.id;

    // Un embudo por empresa, con la misma forma en las dos.
    const construir = async (companyId: string) => {
      const pipeline = await prisma.pipeline.create({
        data: { companyId, name: 'E2E Inicio Embudo', isDefault: true },
      });
      const [nuevo, ganado] = await Promise.all([
        prisma.pipelineStage.create({
          data: {
            pipelineId: pipeline.id,
            name: 'Nuevo',
            order: 0,
            isInitial: true,
          },
        }),
        prisma.pipelineStage.create({
          data: {
            pipelineId: pipeline.id,
            name: 'Ganado',
            order: 1,
            type: 'WON',
          },
        }),
      ]);
      const contacto = await prisma.contact.create({
        data: {
          companyId,
          phone: `+1888${Date.now() % 10000000}`,
          name: 'E2E Inicio Contacto',
        },
      });
      return { pipeline, nuevo, ganado, contacto };
    };

    const ea = await construir(empresaA);
    const eb = await construir(empresaB);

    const ga = await prisma.lead.create({
      data: {
        companyId: empresaA,
        contactId: ea.contacto.id,
        pipelineId: ea.pipeline.id,
        stageId: ea.ganado.id,
        title: 'E2E Inicio Ganada A',
        value: new Prisma.Decimal('1500.50'),
        status: 'WON',
        createdAt: AYER,
      },
    });
    leadGanadaA = ga.id;

    await prisma.lead.create({
      data: {
        companyId: empresaA,
        contactId: ea.contacto.id,
        pipelineId: ea.pipeline.id,
        stageId: ea.nuevo.id,
        title: 'E2E Inicio Abierta A',
        value: new Prisma.Decimal('900.25'),
        status: 'OPEN',
        createdAt: AYER,
      },
    });

    const gb = await prisma.lead.create({
      data: {
        companyId: empresaB,
        contactId: eb.contacto.id,
        pipelineId: eb.pipeline.id,
        stageId: eb.ganado.id,
        title: 'E2E Inicio Ganada B',
        value: new Prisma.Decimal('7777.77'),
        status: 'WON',
        createdAt: AYER,
      },
    });
    leadGanadaB = gb.id;

    // La fecha de cierre sale del historial de etapa, no de `updatedAt`.
    await Promise.all([
      prisma.leadStageHistory.create({
        data: { leadId: leadGanadaA, toStageId: ea.ganado.id, changedAt: AYER },
      }),
      prisma.leadStageHistory.create({
        data: { leadId: leadGanadaB, toStageId: eb.ganado.id, changedAt: AYER },
      }),
    ]);

    await Promise.all([
      prisma.auditLog.create({
        data: {
          affectedCompanyId: empresaA,
          actorUserId: usuarioA,
          actorRole: 'ADMIN',
          action: 'e2e.inicio.accion',
          entityType: 'Lead',
          entityId: leadGanadaA,
          reason: 'TEXTO LIBRE QUE NO DEBE SALIR',
          metadata: { secreto: 'NO DEBE SALIR' },
          ipAddress: '203.0.113.10',
          userAgent: 'e2e/1.0',
        },
      }),
      prisma.auditLog.create({
        data: {
          affectedCompanyId: empresaB,
          actorRole: 'ADMIN',
          action: 'e2e.inicio.accion.otra-empresa',
          entityType: 'Lead',
          metadata: { secreto: 'DE OTRA EMPRESA' },
        },
      }),
    ]);
  });

  afterAll(async () => {
    // Borrado por ID exacto y en orden de dependencias.
    for (const id of [empresaA, empresaB]) {
      await prisma.auditLog.deleteMany({ where: { affectedCompanyId: id } });
      await prisma.leadStageHistory.deleteMany({
        where: { lead: { companyId: id } },
      });
      await prisma.lead.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.pipelineStage.deleteMany({
        where: { pipeline: { companyId: id } },
      });
      await prisma.pipeline.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  describe('sales-trend', () => {
    it('cada empresa ve SOLO su propio dinero', async () => {
      const [ra, rb] = await Promise.all([
        service.getSalesTrend(empresaA, 7),
        service.getSalesTrend(empresaB, 7),
      ]);

      expect(ra.totals.wonValue).toBe(1500.5);
      expect(ra.totals.openedCount).toBe(2);
      expect(rb.totals.wonValue).toBe(7777.77);
      expect(rb.totals.openedCount).toBe(1);

      // Si hubiera fuga, la suma de A incluiría los 7777,77 de B.
      expect(ra.totals.wonValue).not.toBe(rb.totals.wonValue);
    });

    it('coloca la venta en el día de su cambio de etapa', async () => {
      const { points } = await service.getSalesTrend(empresaA, 7);
      const ayer = points.find((p) => p.date === clave(AYER));
      expect(ayer).toMatchObject({ wonCount: 1, wonValue: 1500.5 });
    });

    it('una empresa sin datos devuelve la serie completa en cero, no vacía', async () => {
      const vacia = await prisma.company.create({
        data: { name: 'E2E Inicio Co Vacia' },
      });
      try {
        const r = await service.getSalesTrend(vacia.id, 7);
        expect(r.points).toHaveLength(7);
        expect(r.totals).toMatchObject({ openedCount: 0, wonCount: 0 });
        expect(r.points.every((p) => p.openedCount === 0)).toBe(true);
      } finally {
        await prisma.company.delete({ where: { id: vacia.id } });
      }
    });
  });

  describe('activity', () => {
    it('devuelve solo la auditoría de su empresa', async () => {
      const [ra, rb] = await Promise.all([
        service.getRecentActivity(empresaA),
        service.getRecentActivity(empresaB),
      ]);

      expect(ra.map((x) => x.action)).toContain('e2e.inicio.accion');
      expect(ra.map((x) => x.action)).not.toContain(
        'e2e.inicio.accion.otra-empresa',
      );
      expect(rb.map((x) => x.action)).not.toContain('e2e.inicio.accion');
    });

    it('no devuelve metadata, reason, ip ni userAgent aunque existan en la fila', async () => {
      const [fila] = await service.getRecentActivity(empresaA);

      expect(Object.keys(fila).sort()).toEqual([
        'action',
        'actorName',
        'createdAt',
        'entityType',
        'id',
      ]);
      expect(JSON.stringify(fila)).not.toContain('NO DEBE SALIR');
      expect(JSON.stringify(fila)).not.toContain('203.0.113.10');
    });

    it('trae el nombre de quien actuó', async () => {
      const [fila] = await service.getRecentActivity(empresaA);
      expect(fila.actorName).toBe('E2E Inicio Asesora');
    });
  });
});
