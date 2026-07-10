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

const fakeLogoFile = (overrides: Partial<any> = {}) => ({
  buffer: Buffer.from('fake-image-bytes'),
  originalname: 'logo.png',
  mimetype: 'image/png',
  size: 16,
  ...overrides,
});

describe('OnboardingService', () => {
  let prisma: any;
  let companyBrandingService: any;
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
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) => {
          // Real Prisma returns NULL columns as `null`, never `undefined`,
          // even though `undefined` in the write payload means "omit this
          // field" — mirror that read-back normalization here.
          const data = { ...args.data };
          for (const key of Object.keys(data)) {
            if (data[key] === undefined) data[key] = null;
          }
          return Promise.resolve({
            id: `company-${++idCounter}`,
            status: 'ACTIVE',
            ...data,
          });
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
      pipeline: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `pipeline-${++idCounter}`, ...args.data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      pipelineStage: {
        create: jest.fn((args: any) =>
          Promise.resolve({ id: `stage-${++idCounter}`, ...args.data }),
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      ),
    };

    // Mimics real Prisma behavior: each uploadLogo() call re-reads the
    // company's current logoUrl/secondaryLogoUrl, so calling primary then
    // secondary sequentially accumulates both fields correctly.
    const brandingStore = new Map<
      string,
      { logoUrl: string | null; secondaryLogoUrl: string | null }
    >();
    companyBrandingService = {
      assertValidLogoFile: jest.fn().mockReturnValue('png'),
      uploadLogo: jest.fn((companyId: string, _file: any, type: string) => {
        const current = brandingStore.get(companyId) ?? {
          logoUrl: null,
          secondaryLogoUrl: null,
        };
        const field = type === 'secondary' ? 'secondaryLogoUrl' : 'logoUrl';
        const updated = { ...current, [field]: `/uploads/branding/${companyId}/${type}.png` };
        brandingStore.set(companyId, updated);
        return Promise.resolve({
          companyId,
          ...updated,
          message: 'Logo actualizado correctamente',
        });
      }),
    };

    service = new OnboardingService(prisma, companyBrandingService);
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

  describe('parsePayload', () => {
    it('accepts a plain JSON body unchanged (existing behavior)', async () => {
      const raw = buildDto();

      const dto = await service.parsePayload(raw);

      expect(dto.company.name).toBe('Tehus Rattan');
      expect(dto.admin.email).toBe('admin@tehus.test');
    });

    it('parses a stringified "data" field from a multipart body', async () => {
      const raw = { data: JSON.stringify(buildDto()) };

      const dto = await service.parsePayload(raw);

      expect(dto.company.name).toBe('Tehus Rattan');
      expect(dto.pipeline.stages).toEqual(['Nuevo lead', 'Contactado', 'Cerrado ganado']);
    });

    it('rejects an invalid JSON string in the "data" field', async () => {
      await expect(
        service.parsePayload({ data: '{not-valid-json' }),
      ).rejects.toThrow('El campo "data" debe ser un JSON válido');
    });

    it('rejects a payload missing required fields', async () => {
      await expect(service.parsePayload({ company: { name: 'X' } })).rejects.toThrow();
    });
  });

  describe('branding assets during creation', () => {
    it('validates logo files before creating anything in the database', async () => {
      companyBrandingService.assertValidLogoFile.mockImplementation(() => {
        throw new Error('invalid logo');
      });

      await expect(
        service.createCompany(buildDto(), { logo: fakeLogoFile() }),
      ).rejects.toThrow('invalid logo');

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    it('uploads a primary logo and returns its logoUrl', async () => {
      const result = await service.createCompany(buildDto(), { logo: fakeLogoFile() });

      expect(companyBrandingService.uploadLogo).toHaveBeenCalledWith(
        result.company.id,
        expect.anything(),
        'primary',
      );
      expect(result.company.logoUrl).toMatch(/^\/uploads\/branding\//);
      expect(result.company.secondaryLogoUrl).toBeNull();
    });

    it('uploads both a primary and secondary logo', async () => {
      const result = await service.createCompany(buildDto(), {
        logo: fakeLogoFile(),
        secondaryLogo: fakeLogoFile({ originalname: 'secondary.png' }),
      });

      expect(companyBrandingService.uploadLogo).toHaveBeenCalledTimes(2);
      expect(result.company.logoUrl).toMatch(/^\/uploads\/branding\//);
      expect(result.company.secondaryLogoUrl).toMatch(/^\/uploads\/branding\//);
    });

    it('works with no logo files at all (JSON compatibility)', async () => {
      const result = await service.createCompany(buildDto());

      expect(companyBrandingService.uploadLogo).not.toHaveBeenCalled();
      expect(result.company.logoUrl).toBeNull();
    });

    it('cleans up the created company if saving the logo fails after the transaction', async () => {
      companyBrandingService.uploadLogo.mockRejectedValue(new Error('disk full'));

      await expect(
        service.createCompany(buildDto(), { logo: fakeLogoFile() }),
      ).rejects.toThrow('disk full');

      expect(prisma.pipelineStage.deleteMany).toHaveBeenCalled();
      expect(prisma.pipeline.delete).toHaveBeenCalled();
      expect(prisma.user.deleteMany).toHaveBeenCalled();
      expect(prisma.company.delete).toHaveBeenCalled();
    });
  });
});
