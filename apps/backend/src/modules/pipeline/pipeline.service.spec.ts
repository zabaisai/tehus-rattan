import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

/**
 * CARACTERIZACIÓN — no es una prueba de diseño nuevo.
 *
 * Fija el comportamiento que el módulo tiene HOY, antes de la reforma de
 * pipelines (orden, archivado, probabilidad, tipo de etapa, predeterminado
 * garantizado). Cualquiera de esos cambios debe seguir cumpliendo lo que se
 * afirma aquí, en especial el aislamiento multiempresa: TODO método resuelve
 * primero la pertenencia del pipeline a la empresa del JWT y falla con 404
 * antes de tocar etapas o leads.
 *
 * Ids ficticios; ninguna empresa ni dato real.
 */
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const PIPELINE_A = 'pipeline-a';

describe('PipelineService (caracterización pre-reforma)', () => {
  let prisma: any;
  let service: PipelineService;

  const pipelineRow = {
    id: PIPELINE_A,
    name: 'Ventas',
    isDefault: true,
    companyId: COMPANY_A,
    stages: [],
  };

  beforeEach(() => {
    prisma = {
      pipeline: {
        findMany: jest.fn().mockResolvedValue([pipelineRow]),
        findFirst: jest.fn().mockResolvedValue(pipelineRow),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue(pipelineRow),
      },
      pipelineStage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'stage-new', ...args.data }),
        ),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue({ id: 'stage-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      lead: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    service = new PipelineService(prisma);
  });

  describe('aislamiento multiempresa (invariante que la reforma NO puede romper)', () => {
    it('findAll filtra siempre por companyId', async () => {
      await service.findAll(COMPANY_A);

      expect(prisma.pipeline.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY_A } }),
      );
    });

    it('findById exige que el pipeline pertenezca a la empresa', async () => {
      await service.findById(PIPELINE_A, COMPANY_A);

      expect(prisma.pipeline.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PIPELINE_A, companyId: COMPANY_A },
        }),
      );
    });

    it('findById lanza 404 cuando el pipeline es de otra empresa', async () => {
      prisma.pipeline.findFirst.mockResolvedValue(null);

      await expect(
        service.findById(PIPELINE_A, COMPANY_B),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['findStages', () => service.findStages(PIPELINE_A, COMPANY_B)],
      [
        'createStage',
        () => service.createStage(PIPELINE_A, COMPANY_B, { name: 'X' }),
      ],
      [
        'updateStage',
        () =>
          service.updateStage(PIPELINE_A, 'stage-1', COMPANY_B, { name: 'X' }),
      ],
      [
        'removeStage',
        () => service.removeStage(PIPELINE_A, 'stage-1', COMPANY_B),
      ],
      ['reorderStages', () => service.reorderStages(PIPELINE_A, COMPANY_B, [])],
      ['getKanban', () => service.getKanban(PIPELINE_A, COMPANY_B)],
      ['update', () => service.update(PIPELINE_A, COMPANY_B, { name: 'X' })],
      ['remove', () => service.remove(PIPELINE_A, COMPANY_B)],
    ])(
      '%s falla con 404 y no escribe nada si el pipeline no es de la empresa',
      async (_name, call) => {
        prisma.pipeline.findFirst.mockResolvedValue(null);

        await expect(call()).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.pipelineStage.create).not.toHaveBeenCalled();
        expect(prisma.pipelineStage.update).not.toHaveBeenCalled();
        expect(prisma.pipelineStage.delete).not.toHaveBeenCalled();
        expect(prisma.pipeline.update).not.toHaveBeenCalled();
        expect(prisma.pipeline.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('pipelines', () => {
    it('create fuerza el companyId del contexto, nunca uno del cliente', async () => {
      await service.create(COMPANY_A, { name: 'Nuevo', isDefault: false });

      expect(prisma.pipeline.create).toHaveBeenCalledWith({
        data: { name: 'Nuevo', isDefault: false, companyId: COMPANY_A },
      });
    });

    it('findAll devuelve las etapas ordenadas por `order` ascendente', async () => {
      await service.findAll(COMPANY_A);

      const args = prisma.pipeline.findMany.mock.calls[0][0];
      expect(args.include.stages.orderBy).toEqual({ order: 'asc' });
    });

    it('remove rechaza borrar un pipeline que todavía tiene etapas', async () => {
      prisma.pipelineStage.count.mockResolvedValue(3);

      await expect(
        service.remove(PIPELINE_A, COMPANY_A),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pipeline.delete).not.toHaveBeenCalled();
    });

    it('remove borra cuando no quedan etapas', async () => {
      prisma.pipelineStage.count.mockResolvedValue(0);

      await service.remove(PIPELINE_A, COMPANY_A);

      expect(prisma.pipeline.delete).toHaveBeenCalledWith({
        where: { id: PIPELINE_A },
      });
    });

    // Hoy NO existe garantía de un único predeterminado: el servicio acepta
    // marcar isDefault sin desmarcar el anterior. La reforma debe cerrar este
    // hueco; se deja documentado para que el cambio sea deliberado.
    it('HOY no desmarca el predeterminado anterior al marcar otro (hueco conocido)', async () => {
      await service.update(PIPELINE_A, COMPANY_A, { isDefault: true });

      expect(prisma.pipeline.update).toHaveBeenCalledTimes(1);
      expect(prisma.pipeline.updateMany).toBeUndefined();
    });
  });

  describe('etapas', () => {
    it('createStage calcula el orden como último + 1 cuando no se indica', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's', order: 4 });

      await service.createStage(PIPELINE_A, COMPANY_A, { name: 'Cierre' });

      expect(prisma.pipelineStage.create).toHaveBeenCalledWith({
        data: { name: 'Cierre', order: 5, pipelineId: PIPELINE_A },
      });
    });

    it('createStage usa orden 0 en un pipeline sin etapas', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue(null);

      await service.createStage(PIPELINE_A, COMPANY_A, { name: 'Primera' });

      expect(prisma.pipelineStage.create.mock.calls[0][0].data.order).toBe(0);
    });

    it('createStage respeta un orden explícito', async () => {
      await service.createStage(PIPELINE_A, COMPANY_A, { name: 'X', order: 2 });

      expect(prisma.pipelineStage.create.mock.calls[0][0].data.order).toBe(2);
      expect(prisma.pipelineStage.findFirst).not.toHaveBeenCalled();
    });

    it('updateStage exige que la etapa pertenezca al pipeline', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStage(PIPELINE_A, 'ajena', COMPANY_A, { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.pipelineStage.update).not.toHaveBeenCalled();
    });

    it('removeStage rechaza borrar una etapa con leads y no borra nada', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-1' });
      prisma.lead.count.mockResolvedValue(2);

      await expect(
        service.removeStage(PIPELINE_A, 'stage-1', COMPANY_A),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pipelineStage.delete).not.toHaveBeenCalled();
    });

    it('removeStage borra cuando la etapa está vacía', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-1' });
      prisma.lead.count.mockResolvedValue(0);

      await service.removeStage(PIPELINE_A, 'stage-1', COMPANY_A);

      expect(prisma.pipelineStage.delete).toHaveBeenCalledWith({
        where: { id: 'stage-1' },
      });
    });
  });

  describe('reordenamiento', () => {
    it('rechaza el lote si alguna etapa no pertenece al pipeline', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue([{ id: 'a' }]);

      await expect(
        service.reorderStages(PIPELINE_A, COMPANY_A, [
          { id: 'a', order: 0 },
          { id: 'ajena', order: 1 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('aplica todos los cambios de orden en UNA transacción', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await service.reorderStages(PIPELINE_A, COMPANY_A, [
        { id: 'a', order: 1 },
        { id: 'b', order: 0 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.pipelineStage.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('kanban', () => {
    const stagesConLeads = [
      {
        id: 'stage-1',
        name: 'Nuevo',
        order: 0,
        color: '#131C4A',
        leads: [
          { id: 'l1', value: 1000, contact: {}, agent: {} },
          { id: 'l2', value: 500, contact: {}, agent: {} },
        ],
      },
      { id: 'stage-2', name: 'Cierre', order: 1, color: null, leads: [] },
    ];

    it('solo incluye leads de la empresa y en estado OPEN', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue(stagesConLeads);

      await service.getKanban(PIPELINE_A, COMPANY_A);

      const args = prisma.pipelineStage.findMany.mock.calls[0][0];
      expect(args.include.leads.where).toEqual({
        companyId: COMPANY_A,
        status: 'OPEN',
      });
    });

    it('suma el valor por etapa y cuenta los leads', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue(stagesConLeads);

      const result = await service.getKanban(PIPELINE_A, COMPANY_A);

      expect(result.stages[0].totalValue).toBe(1500);
      expect(result.stages[0].leadCount).toBe(2);
      expect(result.stages[1].totalValue).toBe(0);
      expect(result.stages[1].leadCount).toBe(0);
    });

    it('trata un lead sin valor como 0 y no como NaN', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue([
        {
          id: 's',
          name: 'X',
          order: 0,
          color: null,
          leads: [{ id: 'l', value: null }],
        },
      ]);

      const result = await service.getKanban(PIPELINE_A, COMPANY_A);

      expect(result.stages[0].totalValue).toBe(0);
    });
  });
});
