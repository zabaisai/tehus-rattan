import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  const companyId = 'company-a';
  const userId = 'user-creator';

  // Mirrors the $transaction mock pattern already used elsewhere in this
  // codebase (e.g. onboarding.service.spec.ts): the callback receives the
  // same `prisma` mock object as `tx`, so every model method call inside
  // create()'s transaction is observable through the same jest.fn()s.
  function buildPrisma(overrides: any = {}) {
    const prisma: any = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: 'contact-a' }) },
      pipelineStage: {
        findFirst: jest.fn().mockResolvedValue({ id: 'stage-a', name: 'Nuevo lead' }),
      },
      pipeline: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pipeline-a' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'agent-a' }) },
      lead: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 'lead-1', ...args.data }),
        ),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn((args: any) =>
          Promise.resolve({
            id: args.where.id,
            title: 'Lead',
            stageId: 'stage-a',
            companyId,
            contact: { id: 'contact-a', name: 'Cliente', phone: '300' },
            stage: { id: 'stage-a', name: 'Nuevo lead', color: null },
            agent: null,
          }),
        ),
      },
      leadStageHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history-1' }),
        findMany: jest.fn(),
      },
      ...overrides,
    };
    prisma.$transaction = jest.fn((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
    );
    return prisma;
  }

  function buildData(overrides: Partial<Record<string, any>> = {}) {
    return {
      title: 'Proyecto terraza',
      contactId: 'contact-a',
      pipelineId: 'pipeline-a',
      stageId: 'stage-a',
      ...overrides,
    };
  }

  describe('create', () => {
    it('creates the lead and an initial stage history record (fromStageId null)', async () => {
      const prisma = buildPrisma();
      const service = new LeadsService(prisma);

      const result = await service.create(companyId, userId, buildData());

      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId, stageId: 'stage-a' }),
        }),
      );
      expect(prisma.leadStageHistory.create).toHaveBeenCalledWith({
        data: {
          leadId: 'lead-1',
          fromStageId: null,
          toStageId: 'stage-a',
          changedBy: userId,
        },
      });
      expect(result.id).toBe('lead-1');
    });

    it('creates exactly one history record per lead creation', async () => {
      const prisma = buildPrisma();
      const service = new LeadsService(prisma);

      await service.create(companyId, userId, buildData());

      expect(prisma.leadStageHistory.create).toHaveBeenCalledTimes(1);
      expect(prisma.lead.create).toHaveBeenCalledTimes(1);
    });

    it('points the initial history record at whatever stage the lead was created in, not the pipeline first stage', async () => {
      const prisma = buildPrisma();
      prisma.pipelineStage.findFirst.mockResolvedValue({
        id: 'stage-qualified',
        name: 'Calificado',
      });
      prisma.lead.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'lead-2', ...args.data }),
      );
      const service = new LeadsService(prisma);

      await service.create(companyId, userId, buildData({ stageId: 'stage-qualified' }));

      expect(prisma.leadStageHistory.create).toHaveBeenCalledWith({
        data: {
          leadId: 'lead-2',
          fromStageId: null,
          toStageId: 'stage-qualified',
          changedBy: userId,
        },
      });
    });

    it('returns the created lead with contact/stage/agent relations populated', async () => {
      const prisma = buildPrisma();
      const service = new LeadsService(prisma);

      const result = await service.create(companyId, userId, buildData());

      expect(prisma.lead.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          include: expect.objectContaining({
            contact: expect.anything(),
            stage: expect.anything(),
            agent: expect.anything(),
          }),
        }),
      );
      expect(result.contact).toBeDefined();
    });

    it('rolls back (never creates the lead) when the stage does not belong to the given pipeline', async () => {
      const prisma = buildPrisma();
      prisma.pipelineStage.findFirst.mockResolvedValue(null);
      const service = new LeadsService(prisma);

      await expect(
        service.create(companyId, userId, buildData({ stageId: 'stage-other-tenant' })),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.leadStageHistory.create).not.toHaveBeenCalled();
    });

    it('rolls back when the contact does not belong to the authenticated company', async () => {
      const prisma = buildPrisma();
      prisma.contact.findFirst.mockResolvedValue(null);
      const service = new LeadsService(prisma);

      await expect(service.create(companyId, userId, buildData())).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.leadStageHistory.create).not.toHaveBeenCalled();
    });

    it('rolls back when the pipeline does not belong to the authenticated company', async () => {
      const prisma = buildPrisma();
      prisma.pipeline.findFirst.mockResolvedValue(null);
      const service = new LeadsService(prisma);

      await expect(service.create(companyId, userId, buildData())).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(prisma.leadStageHistory.create).not.toHaveBeenCalled();
    });

    it('propagates a failure creating the history record instead of leaving the lead partially created', async () => {
      const prisma = buildPrisma();
      prisma.leadStageHistory.create.mockRejectedValue(new Error('db write failed'));
      const service = new LeadsService(prisma);

      // The transaction callback throws before returning — with a real
      // Prisma connection this aborts the whole transaction (lead.create is
      // rolled back too). This mock doesn't simulate the database rollback
      // itself, but proves the service never swallows the error or returns
      // a "successful" lead when the history write fails.
      await expect(service.create(companyId, userId, buildData())).rejects.toThrow(
        'db write failed',
      );

      expect(prisma.lead.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('changeStage', () => {
    it('still records fromStageId -> toStageId for a stage transition after creation', async () => {
      const prisma = buildPrisma();
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        companyId,
        pipelineId: 'pipeline-a',
        stageId: 'stage-qualified',
        contact: {},
        stage: {},
        pipeline: {},
        agent: null,
      });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-quote' });
      prisma.lead.update = jest.fn().mockResolvedValue({
        id: 'lead-1',
        stageId: 'stage-quote',
      });

      const service = new LeadsService(prisma);
      await service.changeStage('lead-1', companyId, 'stage-quote', userId);

      expect(prisma.leadStageHistory.create).toHaveBeenCalledWith({
        data: {
          leadId: 'lead-1',
          fromStageId: 'stage-qualified',
          toStageId: 'stage-quote',
          changedBy: userId,
        },
      });
    });
  });

  describe('getHistory', () => {
    it('orders records chronologically ascending (creation first, later transitions after)', async () => {
      const prisma = buildPrisma();
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', companyId });
      prisma.leadStageHistory.findMany.mockResolvedValue([]);

      const service = new LeadsService(prisma);
      await service.getHistory('lead-1', companyId);

      expect(prisma.leadStageHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { changedAt: 'asc' } }),
      );
    });
  });
});
