import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PipelineService } from './pipeline.service';

/**
 * Invariantes de la gestión de pipelines (Fase 4), con Prisma doblado.
 *
 * Regla general: «nunca peor que antes». Un embudo anterior a la fase que no
 * cumpla las invariantes sigue editable, pero ninguna edición puede quitarle
 * lo que ya tiene (la última etapa abierta, ganada o perdida) ni duplicar el
 * cierre. La concurrencia real (bloqueo de fila) se prueba contra PostgreSQL
 * en `test/pipeline-gestion.e2e-spec.ts`.
 */
const COMPANY = 'company-a';
const PIPELINE = 'pipeline-a';

const etapa = (
  id: string,
  type: 'OPEN' | 'WON' | 'LOST',
  extra: Record<string, unknown> = {},
) => ({
  id,
  name: id,
  type,
  order: 0,
  isInitial: false,
  createdAt: new Date(0),
  ...extra,
});

describe('PipelineService — invariantes (Fase 4)', () => {
  let prisma: any;
  let service: PipelineService;
  let etapas: any[];

  beforeEach(() => {
    etapas = [
      etapa('nuevo', 'OPEN', { name: 'Nuevo lead', order: 0, isInitial: true }),
      etapa('propuesta', 'OPEN', { name: 'Propuesta', order: 1 }),
      etapa('ganado', 'WON', { name: 'Ganado', order: 2 }),
      etapa('perdido', 'LOST', { name: 'Perdido', order: 3 }),
    ];
    prisma = {
      pipeline: {
        // Respeta where.id.not: al renombrar, el propio embudo no cuenta.
        findMany: jest.fn(async ({ where }: any = {}) =>
          [
            { id: PIPELINE, name: 'Ventas' },
            { id: 'otro', name: 'Postventa' },
          ].filter((p) => !where?.id?.not || p.id !== where.id.not),
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: PIPELINE,
          name: 'Ventas',
          isDefault: false,
          companyId: COMPANY,
          order: 1,
          stages: [],
        }),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pipelineStage: {
        findMany: jest.fn(async () => etapas),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'stage-new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({ id: 'x' }),
      },
      lead: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
      $queryRaw: jest.fn().mockResolvedValue([{ id: PIPELINE }]),
    };
    service = new PipelineService(prisma);
  });

  describe('nombres', () => {
    it('recorta y colapsa espacios; vacío → 400', async () => {
      await expect(
        service.create(COMPANY, { name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.create(COMPANY, { name: '  Post   venta  ' });
      expect(prisma.pipeline.create.mock.calls[0][0].data.name).toBe(
        'Post venta',
      );
    });

    it('rechaza nombres de pipeline repetidos sin distinguir mayúsculas', async () => {
      await expect(service.create(COMPANY, { name: 'VENTAS' })).rejects.toThrow(
        /Ya existe un pipeline/,
      );
      expect(prisma.pipeline.create).not.toHaveBeenCalled();
    });

    it('renombrar permite conservar el propio nombre y rechaza el de otro', async () => {
      await service.update(PIPELINE, COMPANY, { name: 'Ventas' });
      expect(prisma.pipeline.update).toHaveBeenCalledTimes(1);
      await expect(
        service.update(PIPELINE, COMPANY, { name: 'postventa' }),
      ).rejects.toThrow(/Ya existe un pipeline/);
    });

    it('rechaza nombres de etapa repetidos dentro del embudo y demasiado largos', async () => {
      await expect(
        service.createStage(PIPELINE, COMPANY, { name: 'propuesta' }),
      ).rejects.toThrow(/Ya existe una etapa/);
      await expect(
        service.createStage(PIPELINE, COMPANY, { name: 'x'.repeat(41) }),
      ).rejects.toThrow(/como máximo 40/);
      expect(prisma.pipelineStage.create).not.toHaveBeenCalled();
    });
  });

  describe('cierre único y «nunca peor que antes»', () => {
    it('no se puede crear una segunda etapa ganada ni perdida', async () => {
      await expect(
        service.createStage(PIPELINE, COMPANY, {
          name: 'Cerrado',
          type: 'WON',
        }),
      ).rejects.toThrow(/ya tiene una etapa ganada/);
      await expect(
        service.createStage(PIPELINE, COMPANY, { name: 'Caído', type: 'LOST' }),
      ).rejects.toThrow(/ya tiene una etapa perdida/);
    });

    it('sí se puede crear una etapa abierta más (por defecto OPEN, al final)', async () => {
      await service.createStage(PIPELINE, COMPANY, { name: 'Negociación' });
      expect(prisma.pipelineStage.create).toHaveBeenCalledWith({
        data: {
          name: 'Negociación',
          type: 'OPEN',
          order: 4,
          pipelineId: PIPELINE,
        },
      });
    });

    it('cambiar la única ganada a abierta se bloquea; cambiar una abierta a ganada también (ya hay una)', async () => {
      await expect(
        service.updateStage(PIPELINE, 'ganado', COMPANY, { type: 'OPEN' }),
      ).rejects.toThrow(/única etapa ganada/);
      await expect(
        service.updateStage(PIPELINE, 'propuesta', COMPANY, { type: 'WON' }),
      ).rejects.toThrow(/ya tiene una etapa ganada/);
      expect(prisma.pipelineStage.update).not.toHaveBeenCalled();
    });

    it('un embudo legacy sin etapa ganada puede recibir una', async () => {
      etapas = etapas.filter((s) => s.type !== 'WON');
      await service.createStage(PIPELINE, COMPANY, {
        name: 'Ganado',
        type: 'WON',
      });
      expect(prisma.pipelineStage.create).toHaveBeenCalledTimes(1);
    });

    it('no se puede eliminar la única etapa perdida mientras queden otras', async () => {
      await expect(
        service.removeStage(PIPELINE, 'perdido', COMPANY),
      ).rejects.toThrow(/única etapa perdida/);
      expect(prisma.pipelineStage.delete).not.toHaveBeenCalled();
    });

    it('sí se puede eliminar una abierta sobrante sin oportunidades', async () => {
      await service.removeStage(PIPELINE, 'propuesta', COMPANY);
      expect(prisma.pipelineStage.delete).toHaveBeenCalledWith({
        where: { id: 'propuesta' },
      });
    });

    it('la etapa con oportunidades no se elimina y el conteo va por empresa', async () => {
      prisma.lead.count.mockResolvedValue(2);
      await expect(
        service.removeStage(PIPELINE, 'propuesta', COMPANY),
      ).rejects.toThrow(/2 oportunidades/);
      expect(prisma.lead.count).toHaveBeenCalledWith({
        where: { stageId: 'propuesta', companyId: COMPANY },
      });
    });

    it('tope de etapas por embudo', async () => {
      etapas = Array.from({ length: 20 }, (_, i) =>
        etapa(`e${i}`, 'OPEN', { name: `Etapa ${i}`, order: i }),
      );
      await expect(
        service.createStage(PIPELINE, COMPANY, { name: 'Una más' }),
      ).rejects.toThrow(/como máximo 20 etapas/);
    });
  });

  describe('reordenamiento completo y contiguo', () => {
    it('rechaza una lista parcial', async () => {
      await expect(
        service.reorderStages(PIPELINE, COMPANY, [
          { id: 'nuevo', order: 0 },
          { id: 'propuesta', order: 1 },
        ]),
      ).rejects.toThrow(/todas las etapas/);
    });

    it('rechaza repetidos y huecos en las posiciones', async () => {
      await expect(
        service.reorderStages(PIPELINE, COMPANY, [
          { id: 'nuevo', order: 0 },
          { id: 'propuesta', order: 0 },
          { id: 'ganado', order: 2 },
          { id: 'perdido', order: 3 },
        ]),
      ).rejects.toThrow(/sin huecos ni repetidos/);
      await expect(
        service.reorderStages(PIPELINE, COMPANY, [
          { id: 'nuevo', order: 0 },
          { id: 'nuevo', order: 1 },
          { id: 'ganado', order: 2 },
          { id: 'perdido', order: 3 },
        ]),
      ).rejects.toThrow(/repetidas/);
      expect(prisma.pipelineStage.update).not.toHaveBeenCalled();
    });

    it('aplica una permutación válida dentro de la transacción con el embudo bloqueado', async () => {
      await service.reorderStages(PIPELINE, COMPANY, [
        { id: 'propuesta', order: 0 },
        { id: 'nuevo', order: 1 },
        { id: 'ganado', order: 2 },
        { id: 'perdido', order: 3 },
      ]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.pipelineStage.update).toHaveBeenCalledTimes(4);
    });

    it('un embudo ajeno responde 404 antes de bloquear nada', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(
        service.reorderStages(PIPELINE, 'company-b', [
          { id: 'nuevo', order: 0 },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.pipelineStage.update).not.toHaveBeenCalled();
    });
  });

  describe('concurrencia del predeterminado', () => {
    it('una carrera contra el índice parcial se traduce en 409, no en 500', async () => {
      prisma.pipeline.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.update(PIPELINE, COMPANY, { isDefault: true }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
