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

const VALID_INVITE_CODE = 'TEHUS-AAAA-BBBB-CCCC-DDDD';

describe('OnboardingService', () => {
  let prisma: any;
  let companyBrandingService: any;
  let authService: any;
  let auditLogService: any;
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
      invitationCode: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invitation-1',
          status: 'ACTIVE',
          expiresAt: null,
          codePreview: 'TEHUS-****-****-****-DDDD',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
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

    authService = {
      issueSession: jest.fn((user: any) => ({
        token: `fake-jwt-for-${user.id}`,
        user: { id: user.id, email: user.email, name: user.name },
      })),
    };

    auditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new OnboardingService(
      prisma,
      companyBrandingService,
      authService,
      auditLogService,
    );
  });

  it('creates company + admin + agents + pipeline + stages in one pass', async () => {
    const dto = buildDto({
      agents: [
        { name: 'Asesor Uno', email: 'asesor1@tehus.test', password: 'agentpass123' },
      ],
    });

    const result = await service.createCompany(dto, undefined, VALID_INVITE_CODE);

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

    // Auto-login: the response carries a session for the ADMIN, never for
    // an agent, and it's issued through AuthService rather than signed here.
    expect(authService.issueSession).toHaveBeenCalledTimes(1);
    expect(authService.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.admin.id,
        email: 'admin@tehus.test',
        role: 'ADMIN',
        companyId: result.company.id,
      }),
    );
    expect(result.token).toBe(`fake-jwt-for-${result.admin.id}`);
    expect(result.user).toEqual({
      id: result.admin.id,
      email: 'admin@tehus.test',
      name: 'Admin Tehus',
    });
  });

  it('saves commercial config as settings JSON on the company', async () => {
    const dto = buildDto();
    await service.createCompany(dto, undefined, VALID_INVITE_CODE);

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

    await service.createCompany(dto, undefined, VALID_INVITE_CODE);

    const agentCreateCall = prisma.user.create.mock.calls[1][0];
    expect(agentCreateCall.data.role).toBe('AGENT');
  });

  it('rejects when the admin email already exists in the database', async () => {
    prisma.user.findMany.mockResolvedValue([{ email: 'admin@tehus.test' }]);

    await expect(
      service.createCompany(buildDto(), undefined, VALID_INVITE_CODE),
    ).rejects.toThrow(ConflictException);
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(authService.issueSession).not.toHaveBeenCalled();
  });

  it('rejects when the same email appears twice within the payload', async () => {
    const dto = buildDto({
      agents: [
        { name: 'Duplicado', email: 'admin@tehus.test', password: 'agentpass123' },
      ],
    });

    await expect(
      service.createCompany(dto, undefined, VALID_INVITE_CODE),
    ).rejects.toThrow(ConflictException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(authService.issueSession).not.toHaveBeenCalled();
  });

  it('rejects when no invitation code is provided', async () => {
    await expect(
      service.createCompany(buildDto(), undefined, ''),
    ).rejects.toThrow('El código de invitación es requerido');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('rejects an invitation code that does not match any stored hash', async () => {
    prisma.invitationCode.findUnique.mockResolvedValue(null);

    await expect(
      service.createCompany(buildDto(), undefined, VALID_INVITE_CODE),
    ).rejects.toThrow('Código de invitación inválido');
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('rejects a revoked invitation code', async () => {
    prisma.invitationCode.findUnique.mockResolvedValue({
      id: 'invitation-1',
      status: 'REVOKED',
      expiresAt: null,
    });

    await expect(
      service.createCompany(buildDto(), undefined, VALID_INVITE_CODE),
    ).rejects.toThrow('Código de invitación revocado');
  });

  it('rejects an already-used invitation code', async () => {
    prisma.invitationCode.findUnique.mockResolvedValue({
      id: 'invitation-1',
      status: 'USED',
      expiresAt: null,
    });

    await expect(
      service.createCompany(buildDto(), undefined, VALID_INVITE_CODE),
    ).rejects.toThrow('Código de invitación ya utilizado');
  });

  it('rejects an expired invitation code', async () => {
    prisma.invitationCode.findUnique.mockResolvedValue({
      id: 'invitation-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.createCompany(buildDto(), undefined, VALID_INVITE_CODE),
    ).rejects.toThrow('Código de invitación vencido');
  });

  it('marks the invitation code as used and links it to the created company', async () => {
    const result = await service.createCompany(buildDto(), undefined, VALID_INVITE_CODE);

    expect(prisma.invitationCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'invitation-1', status: 'ACTIVE' }),
        data: { status: 'USED', usedAt: expect.any(Date) },
      }),
    );
    expect(prisma.invitationCode.update).toHaveBeenCalledWith({
      where: { id: 'invitation-1' },
      data: { companyId: result.company.id, usedByUserId: result.admin.id },
    });
    expect(auditLogService.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'USE_INVITATION_CODE' }),
    );
  });

  it('rejects when a concurrent request already claimed the invitation code', async () => {
    prisma.invitationCode.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createCompany(buildDto(), undefined, VALID_INVITE_CODE),
    ).rejects.toThrow('Código de invitación ya utilizado');
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

    await expect(
      service.createCompany(dto, undefined, VALID_INVITE_CODE),
    ).rejects.toThrow('boom');
    expect(prisma.pipeline.create).not.toHaveBeenCalled();
    expect(prisma.pipelineStage.create).not.toHaveBeenCalled();
    expect(authService.issueSession).not.toHaveBeenCalled();
  });

  it('appends a numeric suffix to the slug when the base slug is taken', async () => {
    prisma.company.findUnique.mockImplementation(({ where }: any) =>
      where.slug === 'tehus-rattan' ? Promise.resolve({ id: 'existing' }) : Promise.resolve(null),
    );

    const result = await service.createCompany(buildDto(), undefined, VALID_INVITE_CODE);

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
        service.createCompany(buildDto(), { logo: fakeLogoFile() }, VALID_INVITE_CODE),
      ).rejects.toThrow('invalid logo');

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    it('uploads a primary logo and returns its logoUrl', async () => {
      const result = await service.createCompany(
        buildDto(),
        { logo: fakeLogoFile() },
        VALID_INVITE_CODE,
      );

      expect(companyBrandingService.uploadLogo).toHaveBeenCalledWith(
        result.company.id,
        expect.anything(),
        'primary',
      );
      expect(result.company.logoUrl).toMatch(/^\/uploads\/branding\//);
      expect(result.company.secondaryLogoUrl).toBeNull();
      // Auto-login also works on the logo path — the session is issued only
      // after the logo upload above has already resolved successfully.
      expect(authService.issueSession).toHaveBeenCalledTimes(1);
      expect(result.token).toBe(`fake-jwt-for-${result.admin.id}`);
    });

    it('uploads both a primary and secondary logo', async () => {
      const result = await service.createCompany(
        buildDto(),
        {
          logo: fakeLogoFile(),
          secondaryLogo: fakeLogoFile({ originalname: 'secondary.png' }),
        },
        VALID_INVITE_CODE,
      );

      expect(companyBrandingService.uploadLogo).toHaveBeenCalledTimes(2);
      expect(result.company.logoUrl).toMatch(/^\/uploads\/branding\//);
      expect(result.company.secondaryLogoUrl).toMatch(/^\/uploads\/branding\//);
    });

    it('works with no logo files at all (JSON compatibility)', async () => {
      const result = await service.createCompany(buildDto(), undefined, VALID_INVITE_CODE);

      expect(companyBrandingService.uploadLogo).not.toHaveBeenCalled();
      expect(result.company.logoUrl).toBeNull();
      expect(result.token).toBe(`fake-jwt-for-${result.admin.id}`);
    });

    it('cleans up the created company if saving the logo fails after the transaction', async () => {
      companyBrandingService.uploadLogo.mockRejectedValue(new Error('disk full'));

      await expect(
        service.createCompany(buildDto(), { logo: fakeLogoFile() }, VALID_INVITE_CODE),
      ).rejects.toThrow('disk full');

      expect(prisma.pipelineStage.deleteMany).toHaveBeenCalled();
      expect(prisma.pipeline.delete).toHaveBeenCalled();
      expect(prisma.user.deleteMany).toHaveBeenCalled();
      expect(prisma.company.delete).toHaveBeenCalled();
      // A logo failure means the company is rolled back — no session should
      // ever be issued for a company that no longer exists.
      expect(authService.issueSession).not.toHaveBeenCalled();
      // The invitation code must be restored to ACTIVE so the same code can
      // be retried once the underlying logo problem is fixed.
      expect(prisma.invitationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });
  });
});
