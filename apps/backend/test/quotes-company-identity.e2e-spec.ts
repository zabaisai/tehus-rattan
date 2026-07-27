import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuotesService } from '../src/modules/quotes/quotes.service';

// Talks to the real local Postgres (same pattern as leads-history.e2e-spec.ts)
// rather than mocking Prisma, to prove end-to-end that GET /quotes/:id returns
// the OWNING company's fiscal identity and stays tenant-isolated. Requires
// `docker-compose up -d postgres` with migrations applied. All data is
// synthetic and cleaned up in afterAll. No external calls.
describe('Quote company identity (e2e, real database)', () => {
  let prisma: PrismaService;
  let service: QuotesService;

  const stamp = Date.now();
  const ids: {
    companyA?: string;
    companyB?: string;
    quoteA?: string;
    quoteB?: string;
    pipelineA?: string;
    pipelineB?: string;
    contactA?: string;
    contactB?: string;
    leadA?: string;
    leadB?: string;
  } = {};

  async function seedCompany(fiscal: {
    name: string;
    legalName: string;
    taxId: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    country: string;
    quoteFooter: string;
  }) {
    const company = await prisma.company.create({ data: fiscal });
    const contact = await prisma.contact.create({
      data: { companyId: company.id, phone: `+1000${stamp}${company.id.slice(-3)}`, name: 'E2E Cliente' },
    });
    const pipeline = await prisma.pipeline.create({
      data: { companyId: company.id, name: 'E2E Pipeline' },
    });
    const stage = await prisma.pipelineStage.create({
      data: { pipelineId: pipeline.id, name: 'Cotizado', order: 0 },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: 'E2E Lead',
      },
    });
    const quote = await prisma.quote.create({
      data: {
        number: 'E2E-0001',
        companyId: company.id,
        leadId: lead.id,
        subtotal: 100,
        discount: 0,
        total: 100,
        items: {
          create: [
            { name: 'Item', description: null, category: null, quantity: 1, unitPrice: 100, subtotal: 100 },
          ],
        },
      },
    });
    return { company, contact, pipeline, lead, quote };
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new QuotesService(prisma);

    const a = await seedCompany({
      name: 'E2E Empresa A',
      legalName: 'E2E Empresa A S.A.S',
      taxId: `A-${stamp}`,
      email: 'facturacion@e2e-a.local',
      phone: '+57 300 000 0001',
      address: 'Calle A #1-1',
      city: 'Ciudad A',
      country: 'País A',
      quoteFooter: 'Condiciones E2E A.',
    });
    const b = await seedCompany({
      name: 'E2E Empresa B',
      legalName: 'E2E Empresa B Ltda',
      taxId: `B-${stamp}`,
      email: 'facturacion@e2e-b.local',
      phone: '+57 300 000 0002',
      address: 'Calle B #2-2',
      city: 'Ciudad B',
      country: 'País B',
      quoteFooter: 'Condiciones E2E B.',
    });

    ids.companyA = a.company.id;
    ids.companyB = b.company.id;
    ids.quoteA = a.quote.id;
    ids.quoteB = b.quote.id;
    ids.pipelineA = a.pipeline.id;
    ids.pipelineB = b.pipeline.id;
    ids.contactA = a.contact.id;
    ids.contactB = b.contact.id;
    ids.leadA = a.lead.id;
    ids.leadB = b.lead.id;
  });

  afterAll(async () => {
    for (const companyId of [ids.companyA, ids.companyB].filter(Boolean) as string[]) {
      await prisma.quote.deleteMany({ where: { companyId } }); // quote_items cascade
      await prisma.lead.deleteMany({ where: { companyId } });
      const pipelines = await prisma.pipeline.findMany({ where: { companyId }, select: { id: true } });
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: { in: pipelines.map((p) => p.id) } } });
      await prisma.pipeline.deleteMany({ where: { companyId } });
      await prisma.contact.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    }
    await prisma.$disconnect();
  });

  it("returns the owning company's fiscal identity with the quote", async () => {
    const quote: any = await service.findById(ids.quoteA!, ids.companyA!);

    expect(quote.company).toBeDefined();
    expect(quote.company.name).toBe('E2E Empresa A');
    expect(quote.company.taxId).toBe(`A-${stamp}`);
    expect(quote.company.quoteFooter).toBe('Condiciones E2E A.');
    expect(quote.items).toHaveLength(1);
  });

  it('exposes only the curated identity fields — never settings, status, slug or timestamps', async () => {
    const quote: any = await service.findById(ids.quoteA!, ids.companyA!);

    const keys = Object.keys(quote.company).sort();
    expect(keys).toEqual(
      [
        'address',
        'city',
        'country',
        'email',
        'id',
        'legalName',
        'logoUrl',
        'name',
        'phone',
        'quoteFooter',
        'taxId',
        'website',
      ].sort(),
    );
    for (const forbidden of ['settings', 'status', 'slug', 'createdAt', 'updatedAt', 'secondaryLogoUrl']) {
      expect(quote.company).not.toHaveProperty(forbidden);
    }
  });

  it('does not leak Empresa B data into Empresa A (distinct owners)', async () => {
    const quoteA: any = await service.findById(ids.quoteA!, ids.companyA!);
    const quoteB: any = await service.findById(ids.quoteB!, ids.companyB!);

    expect(quoteA.company.taxId).toBe(`A-${stamp}`);
    expect(quoteB.company.taxId).toBe(`B-${stamp}`);
    expect(JSON.stringify(quoteA)).not.toContain('E2E Empresa B');
    expect(JSON.stringify(quoteA)).not.toContain(`B-${stamp}`);
  });

  it("rejects a user of Empresa A reading Empresa B's quote (tenant isolation)", async () => {
    await expect(service.findById(ids.quoteB!, ids.companyA!)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
