import { PrismaService } from '../src/prisma/prisma.service';
import { LeadsService } from '../src/modules/leads/leads.service';

// Unlike the other e2e specs in this directory (which mock the service
// layer to exercise only the HTTP guard pipeline), this spec talks to a
// real Postgres database through PrismaService, because the bug it
// guards against is a database foreign key constraint that a mocked
// Prisma client cannot reproduce. Requires `docker-compose up -d postgres`
// with the schema migrated, matching the project's documented local
// dev setup (see docs/SUPPORT_MODE.md "Operación local").
describe('LeadsService.remove (e2e, real database)', () => {
  let prisma: PrismaService;
  let service: LeadsService;

  let companyId: string;
  let contactId: string;
  let pipelineId: string;
  let stageAId: string;
  let stageBId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new LeadsService(prisma);

    const company = await prisma.company.create({
      data: { name: 'E2E Leads Delete Test Co' },
    });
    companyId = company.id;

    const contact = await prisma.contact.create({
      data: { companyId, phone: '+10000000000', name: 'E2E Test Contact' },
    });
    contactId = contact.id;

    const pipeline = await prisma.pipeline.create({
      data: { companyId, name: 'E2E Test Pipeline' },
    });
    pipelineId = pipeline.id;

    const stageA = await prisma.pipelineStage.create({
      data: { pipelineId, name: 'Stage A', order: 0 },
    });
    stageAId = stageA.id;

    const stageB = await prisma.pipelineStage.create({
      data: { pipelineId, name: 'Stage B', order: 1 },
    });
    stageBId = stageB.id;
  });

  afterAll(async () => {
    // Defensive cleanup that doesn't rely on the fix under test: remove
    // any stage history and leads left over first, regardless of whether
    // LeadsService.remove succeeded, so the FK chain never blocks teardown.
    const leftoverLeads = await prisma.lead.findMany({
      where: { companyId },
      select: { id: true },
    });
    await prisma.leadStageHistory.deleteMany({
      where: { leadId: { in: leftoverLeads.map((l) => l.id) } },
    });
    await prisma.lead.deleteMany({ where: { companyId } });
    await prisma.pipelineStage.deleteMany({ where: { pipelineId } });
    await prisma.pipeline.delete({ where: { id: pipelineId } });
    await prisma.contact.delete({ where: { id: contactId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('deletes a lead that has stage history, instead of failing with a foreign key error', async () => {
    const lead = await prisma.lead.create({
      data: {
        companyId,
        contactId,
        pipelineId,
        stageId: stageAId,
        title: 'E2E Test Lead',
      },
    });

    // Reproduces the original bug: a lead that has ever changed stage has
    // a LeadStageHistory row pointing at it.
    await prisma.leadStageHistory.create({
      data: {
        leadId: lead.id,
        fromStageId: stageAId,
        toStageId: stageBId,
      },
    });

    await expect(service.remove(lead.id, companyId)).resolves.toBeDefined();

    const remainingLead = await prisma.lead.findUnique({
      where: { id: lead.id },
    });
    expect(remainingLead).toBeNull();

    const remainingHistory = await prisma.leadStageHistory.findMany({
      where: { leadId: lead.id },
    });
    expect(remainingHistory).toHaveLength(0);
  });
});
