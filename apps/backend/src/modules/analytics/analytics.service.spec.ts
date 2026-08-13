import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

/**
 * Prisma falso. Interesa QUÉ `where` se construye y cómo se agrupan las
 * fechas, no qué devuelve la base: el aislamiento se rompe en el `where`, no
 * en el resultado.
 */
function prismaFalso() {
  return {
    lead: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    pipeline: { findFirst: jest.fn() },
    pipelineStage: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    task: { count: jest.fn() },
    conversation: { count: jest.fn() },
  };
}

/** Un día a las 10:00 LOCALES, que es donde se rompe el agrupado por UTC. */
function diaLocal(desplazamiento: number): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() + desplazamiento);
  return d;
}

function clave(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: ReturnType<typeof prismaFalso>;

  beforeEach(async () => {
    prisma = prismaFalso();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AnalyticsService);
  });

  describe('getSalesTrend — aislamiento', () => {
    it('las dos consultas llevan companyId DENTRO del where', async () => {
      await service.getSalesTrend('empresa-1');

      expect(prisma.lead.findMany).toHaveBeenCalledTimes(2);
      for (const llamada of prisma.lead.findMany.mock.calls) {
        expect(llamada[0].where).toEqual(
          expect.objectContaining({ companyId: 'empresa-1' }),
        );
      }
    });

    it('no acepta un companyId distinto por parámetro de ventana', async () => {
      await service.getSalesTrend('empresa-1', 30);
      const wheres = prisma.lead.findMany.mock.calls.map((c) => c[0].where);
      expect(wheres.every((w) => w.companyId === 'empresa-1')).toBe(true);
    });
  });

  describe('getSalesTrend — ventana', () => {
    it('recorta days a 7–90 y devuelve un punto por día', async () => {
      expect((await service.getSalesTrend('e1', 1)).days).toBe(7);
      expect((await service.getSalesTrend('e1', 5000)).days).toBe(90);
      const normal = await service.getSalesTrend('e1', 30);
      expect(normal.days).toBe(30);
      expect(normal.points).toHaveLength(30);
    });

    it('sin days usa 30', async () => {
      expect((await service.getSalesTrend('e1')).days).toBe(30);
    });

    it('un days no numérico cae al valor por defecto, no a NaN', async () => {
      const r = await service.getSalesTrend('e1', Number('hola'));
      expect(r.days).toBe(30);
      expect(r.points).toHaveLength(30);
    });

    it('los días salen sin huecos y en orden', async () => {
      const { points } = await service.getSalesTrend('e1', 7);
      const fechas = points.map((p) => p.date);
      expect(fechas).toHaveLength(7);
      expect([...fechas].sort()).toEqual(fechas);
      expect(fechas[6]).toBe(clave(diaLocal(0)));
    });
  });

  describe('getSalesTrend — de dónde sale cada fecha', () => {
    it('una oportunidad abierta se coloca en el día LOCAL de createdAt', async () => {
      prisma.lead.findMany
        .mockResolvedValueOnce([
          { createdAt: diaLocal(-2), value: new Prisma.Decimal(1000) },
        ])
        .mockResolvedValueOnce([]);

      const { points, totals } = await service.getSalesTrend('e1', 7);
      const punto = points.find((p) => p.date === clave(diaLocal(-2)));
      expect(punto).toMatchObject({ openedCount: 1, openedValue: 1000 });
      expect(totals.openedCount).toBe(1);
    });

    it('una ganada se fecha por su ÚLTIMO cambio de etapa, no por updatedAt', async () => {
      prisma.lead.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          value: new Prisma.Decimal(5000),
          stageHistory: [{ changedAt: diaLocal(-1) }],
        },
      ]);

      const { points, totals, wonWithoutDate } = await service.getSalesTrend(
        'e1',
        7,
      );
      expect(points.find((p) => p.date === clave(diaLocal(-1)))).toMatchObject({
        wonCount: 1,
        wonValue: 5000,
      });
      expect(totals.wonValue).toBe(5000);
      expect(wonWithoutDate).toBe(0);
    });

    it('una ganada SIN historial no se coloca en ningún día: se cuenta aparte', async () => {
      // Es la regla que impide fabricar un dato. Empujarla al último día
      // habría dibujado una venta que nadie hizo hoy.
      prisma.lead.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { value: new Prisma.Decimal(9000), stageHistory: [] },
        ]);

      const { points, totals, wonWithoutDate } = await service.getSalesTrend(
        'e1',
        7,
      );
      expect(wonWithoutDate).toBe(1);
      expect(totals.wonCount).toBe(0);
      expect(points.every((p) => p.wonCount === 0)).toBe(true);
    });

    it('separa la ventana actual de la previa para poder comparar', async () => {
      prisma.lead.findMany
        .mockResolvedValueOnce([
          { createdAt: diaLocal(-1), value: new Prisma.Decimal(100) },
          { createdAt: diaLocal(-10), value: new Prisma.Decimal(400) },
        ])
        .mockResolvedValueOnce([]);

      const { totals, previous } = await service.getSalesTrend('e1', 7);
      expect(totals).toMatchObject({ openedCount: 1, openedValue: 100 });
      expect(previous).toMatchObject({ openedCount: 1, openedValue: 400 });
    });

    it('suma el dinero en Decimal: 0,1 + 0,2 no puede dar 0,30000000000000004', async () => {
      prisma.lead.findMany
        .mockResolvedValueOnce([
          { createdAt: diaLocal(-1), value: new Prisma.Decimal('0.1') },
          { createdAt: diaLocal(-1), value: new Prisma.Decimal('0.2') },
        ])
        .mockResolvedValueOnce([]);

      const { totals, points } = await service.getSalesTrend('e1', 7);
      expect(totals.openedValue).toBe(0.3);
      expect(
        points.find((p) => p.date === clave(diaLocal(-1)))?.openedValue,
      ).toBe(0.3);
    });

    it('un valor nulo cuenta como oportunidad pero no suma dinero', async () => {
      prisma.lead.findMany
        .mockResolvedValueOnce([{ createdAt: diaLocal(-1), value: null }])
        .mockResolvedValueOnce([]);

      const { totals } = await service.getSalesTrend('e1', 7);
      expect(totals).toMatchObject({ openedCount: 1, openedValue: 0 });
    });
  });

  describe('getRecentActivity', () => {
    it('consulta solo la auditoría de ESTA empresa', async () => {
      await service.getRecentActivity('empresa-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { affectedCompanyId: 'empresa-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('NO selecciona metadata, reason, entityId, ip ni userAgent', async () => {
      // El panel dice qué pasó y quién lo hizo. `metadata` lleva los valores
      // antiguos y nuevos de lo que se cambió, y `reason` es texto libre: ni
      // uno ni otro deben salir por un panel de inicio.
      await service.getRecentActivity('empresa-1');

      const select = prisma.auditLog.findMany.mock.calls[0][0].select;
      for (const prohibido of [
        'metadata',
        'reason',
        'entityId',
        'ipAddress',
        'userAgent',
      ]) {
        expect(select).not.toHaveProperty(prohibido);
      }
      expect(select).toMatchObject({
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
      });
    });

    it('recorta el límite a 1–20 y usa 8 por defecto', async () => {
      await service.getRecentActivity('e1');
      expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(8);

      await service.getRecentActivity('e1', 500);
      expect(prisma.auditLog.findMany.mock.calls[1][0].take).toBe(20);

      await service.getRecentActivity('e1', 0);
      expect(prisma.auditLog.findMany.mock.calls[2][0].take).toBe(8);

      await service.getRecentActivity('e1', -3);
      expect(prisma.auditLog.findMany.mock.calls[3][0].take).toBe(1);
    });

    it('un actor dado de baja llega como null, no rompe la fila', async () => {
      const creado = new Date();
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'a1',
          action: 'contact.archive',
          entityType: 'Contact',
          createdAt: creado,
          actor: null,
        },
      ]);

      await expect(service.getRecentActivity('e1')).resolves.toEqual([
        {
          id: 'a1',
          action: 'contact.archive',
          entityType: 'Contact',
          createdAt: creado,
          actorName: null,
        },
      ]);
    });
  });
});
