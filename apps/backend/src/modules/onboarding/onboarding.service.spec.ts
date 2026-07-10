import { ConflictException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CreateOnboardingCompanyDto } from './dto/create-onboarding-company.dto';

function buildDto(
  overrides: Partial<CreateOnboardingCompanyDto> = {},
): CreateOnboardingCompanyDto {
  return {
    company: { name: 'Tehus Rattan' },
    commercial: {
      sellsProducts: true,
      sellsServices: false,
      usesCatalog: true,
      usesQuotes: false,
      usesTasks: true,
      categories: ['Salas', 'Comedores'],
    },
    pipeline: {
      name: 'Ventas',
      stages: ['Nuevo lead', 'Contactado', 'Cerrado ganado'],
    },
    admin: {
      name: 'Admin Tehus',
      email: 'admin@tehus.test',
      password: 'supersecret123',
    },
    ...overrides,
  } as CreateOnboardingCompanyDto;
}

describe('OnboardingService', () => {
  let prisma: any;
  let service: OnboardingService;
  let idCounter: number;

  beforeEach(() => {
    idCounter = 0;
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `user-${++idCounter}`, ...args.data }),
        ),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `company-${++idCounter}`, status: 'ACTIVE', ...args.data }),
        ),
      },
      pipeline: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `pipeline-${++idCounter}`, ...args.data }),
        ),
      },
      pipelineStage: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `stage-${++idCounter}`, ...args.data }),
        ),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<any>) => callback(prisma)),
    };

    service = new OnboardingService(prisma);
  });

  it('creates company + admin + agents + pipeline + stages in one pass', async () => {
    const dto = buildDto({
      agents: [
        { name: 'Asesor Uno', email: 'asesor1@tehus.test', password: 'agentpass123' },
      ],
    });

    const result = await service.createCompany(dto);

    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
    expect(prisma.pipeline.create).toHaveBeenCalledTimes(1);
    expect(prisma.pipelineStage.create).toHaveBeenCalledTimes(3);

    expect(result.message).toBe('Empresa creada correctamente');
    expect(result.company.slug).toBe('tehus-rattan');
    expect(result.admin.role).toBe('ADMIN');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].role).toBe('AGENT');
    expect(result.stages.map((s) => s.name)).toEqual([
      'Nuevo lead',
      'Contactado',
      'Cerrado ganado',
    ]);
  });

  it('saves commercial config as settings JSON on the company', async () => {
    const dto = buildDto();
    await service.createCompany(dto);

    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: {
            sellsProducts: true,
            sellsServices: false,
            usesCatalog: true,
            usesQuotes: false,
            usesTasks: true,
            categories: ['Salas', 'Comedores'],
          },
        }),
      }),
    );
  });

  it('never allows an agent to be created with a role other than AGENT', async () => {
    const dto = buildDto({
      agents: [
        {
          name: 'Intento Admin',
          email: 'intento@tehus.test',
          password: 'agentpass123',
          role: 'AGENT',
        },
      ],
    });

    await service.createCompany(dto);

    const agentCreateCall = prisma.user.create.mock.calls[1][0];
    expect(agentCreateCall.data.role).toBe('AGENT');
  });

  it('rejects when the admin email already exists in the database', async () => {
    prisma.user.findMany.mockResolvedValue([{ email: 'admin@tehus.test' }]);

    await expect(service.createCompany(buildDto())).rejects.toThrow(ConflictException);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('rejects when the same email appears twice within the payload', async () => {
    const dto = buildDto({
      agents: [
        { name: 'Duplicado', email: 'admin@tehus.test', password: 'agentpass123' },
      ],
    });

    await expect(service.createCompany(dto)).rejects.toThrow(ConflictException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('does not create the pipeline if creating an agent fails (no half-created company)', async () => {
    prisma.user.create.mockImplementation((args: any) => {
      if (args.data.role === 'AGENT') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve({ id: `user-${++idCounter}`, ...args.data });
    });

    const dto = buildDto({
      agents: [
        { name: 'Asesor Falla', email: 'asesor-falla@tehus.test', password: 'agentpass123' },
      ],
    });

    await expect(service.createCompany(dto)).rejects.toThrow('boom');
    expect(prisma.pipeline.create).not.toHaveBeenCalled();
    expect(prisma.pipelineStage.create).not.toHaveBeenCalled();
  });

  it('appends a numeric suffix to the slug when the base slug is taken', async () => {
    prisma.company.findUnique.mockImplementation(({ where }: any) =>
      where.slug === 'tehus-rattan' ? Promise.resolve({ id: 'existing' }) : Promise.resolve(null),
    );

    const result = await service.createCompany(buildDto());

    expect(result.company.slug).toBe('tehus-rattan-2');
  });
});
