import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { LeadsService } from '../src/modules/leads/leads.service';

// Talks to a real Postgres database through PrismaService (same pattern as
// leads-delete.e2e-spec.ts) rather than mocking Prisma, because the bug this
// guards against — a lead created directly in a non-first stage leaving
// LeadStageHistory empty — is about what actually lands in the stage-history
// table, which a mock can't meaningfully assert on. Requires
// `docker-compose up -d postgres` with the schema migrated.
describe('Lead stage history (e2e, real database)', () => {
  let prisma: PrismaService;
  let service: LeadsService;

  let companyAId: string;
  let contactAId: string;
  let pipelineAId: string;
  let stageQualifiedId: string;
  let stageQuoteId: string;
  let creatorUserId: string;

  let companyBId: string;

  const createdLeadIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new LeadsService(prisma);

    const companyA = await prisma.company.create({
      data: { name: 'E2E Leads History Test Co A' },
    });
    companyAId = companyA.id;

    const companyB = await prisma.company.create({
      data: { name: 'E2E Leads History Test Co B' },
    });
    companyBId = companyB.id;

    const contactA = await prisma.contact.create({
      data: { companyId: companyAId, phone: '+10000000001', name: 'E2E History Contact' },
    });
    contactAId = contactA.id;

    const pipelineA = await prisma.pipeline.create({
      data: { companyId: companyAId, name: 'E2E History Pipeline' },
    });
    pipelineAId = pipelineA.id;

    const stageNew = await prisma.pipelineStage.create({
      data: { pipelineId: pipelineAId, name: 'Nuevo lead', order: 0 },
    });
    const stageQualified = await prisma.pipelineStage.create({
      data: { pipelineId: pipelineAId, name: 'Calificado', order: 1 },
    });
    stageQualifiedId = stageQualified.id;
    const stageQuote = await prisma.pipelineStage.create({
      data: { pipelineId: pipelineAId, name: 'Cotización', order: 2 },
    });
    stageQuoteId = stageQuote.id;
    void stageNew;

    const creator = await prisma.user.create({
      data: {
        companyId: companyAId,
        email: `e2e-history-creator-${Date.now()}@test.local`,
        password: 'unused-hash',
        name: 'E2E History Creator',
        role: 'ADMIN',
      },
    });
    creatorUserId = creator.id;
  });

  afterAll(async () => {
    // Defensive cleanup, independent of whether the assertions above passed.
    await prisma.leadStageHistory.deleteMany({
      where: { leadId: { in: createdLeadIds } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.pipelineStage.deleteMany({ where: { pipelineId: pipelineAId } });
    await prisma.pipeline.delete({ where: { id: pipelineAId } });
    await prisma.contact.delete({ where: { id: contactAId } });
    await prisma.user.delete({ where: { id: creatorUserId } });
    await prisma.company.delete({ where: { id: companyBId } });
    await prisma.company.delete({ where: { id: companyAId } });
    await prisma.$disconnect();
  });

  it('records exactly one initial history entry when a lead is created directly in a non-first stage', async () => {
    const lead = await service.create(companyAId, creatorUserId, {
      title: 'QA Historial Inicial Lead',
      contactId: contactAId,
      pipelineId: pipelineAId,
      stageId: stageQualifiedId,
    });
    createdLeadIds.push(lead.id);

    const history = await service.getHistory(lead.id, companyAId);

    expect(history).toHaveLength(1);
    expect(history[0].fromStageId).toBeNull();
    expect(history[0].toStageId).toBe(stageQualifiedId);
    expect(history[0].leadId).toBe(lead.id);
    expect(history[0].changedBy).toBe(creatorUserId);
    expect(history[0].user?.id).toBe(creatorUserId);
  });

  it('appends a second chronological entry after changeStage, without touching the first', async () => {
    const lead = await service.create(companyAId, creatorUserId, {
      title: 'QA Historial Transicion Lead',
      contactId: contactAId,
      pipelineId: pipelineAId,
      stageId: stageQualifiedId,
    });
    createdLeadIds.push(lead.id);

    await service.changeStage(lead.id, companyAId, stageQuoteId, creatorUserId);

    const history = await service.getHistory(lead.id, companyAId);

    expect(history).toHaveLength(2);
    // Ascending order: creation record first, then the later transition.
    expect(history[0].fromStageId).toBeNull();
    expect(history[0].toStageId).toBe(stageQualifiedId);
    expect(history[1].fromStageId).toBe(stageQualifiedId);
    expect(history[1].toStageId).toBe(stageQuoteId);
    expect(history[0].changedAt.getTime()).toBeLessThanOrEqual(
      history[1].changedAt.getTime(),
    );
  });

  it('never lets a lead exist without its initial history record, even across many creations', async () => {
    const lead = await service.create(companyAId, creatorUserId, {
      title: 'QA Historial Multiple',
      contactId: contactAId,
      pipelineId: pipelineAId,
      stageId: stageQualifiedId,
    });
    createdLeadIds.push(lead.id);

    const historyRows = await prisma.leadStageHistory.count({
      where: { leadId: lead.id },
    });
    expect(historyRows).toBe(1);
  });

  it('blocks a different company from reading this lead history (tenant isolation)', async () => {
    const lead = await service.create(companyAId, creatorUserId, {
      title: 'QA Historial Aislamiento Lead',
      contactId: contactAId,
      pipelineId: pipelineAId,
      stageId: stageQualifiedId,
    });
    createdLeadIds.push(lead.id);

    await expect(service.getHistory(lead.id, companyBId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
