import 'reflect-metadata';
import { CompaniesController } from './companies.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';

// Proves the permission model of /companies/me at the controller boundary:
// - GET is open to any authenticated role,
// - PATCH and POST /me/logo require ADMIN/SUPER_ADMIN (RolesGuard),
// - every write scopes to req.user.companyId (JWT), never a body companyId,
// - the class-level guards include BusinessTenantGuard (which rejects a
//   SUPER_ADMIN with companyId=null) and RolesGuard (which rejects AGENT).
// Runtime rejection of missing/expired tokens and null-companyId is covered by
// test/auth-guard.e2e-spec.ts and test/business-tenant-guard.e2e-spec.ts.
describe('CompaniesController', () => {
  let companiesService: any;
  let brandingService: any;
  let tenantConfiguration: any;
  let controller: CompaniesController;

  const buildRequest = (companyId: string | null) => ({
    user: { sub: 'user-1', role: 'ADMIN', companyId },
  });

  beforeEach(() => {
    companiesService = { findById: jest.fn(), update: jest.fn() };
    brandingService = { uploadLogo: jest.fn() };
    tenantConfiguration = {
      get: jest.fn(),
      update: jest.fn(),
      getLegacySettings: jest.fn(),
      updateLegacySettings: jest.fn(),
    };
    controller = new CompaniesController(
      companiesService,
      brandingService,
      tenantConfiguration,
    );
  });

  describe('GET/PATCH /me/configuration (Fase 2)', () => {
    it('GET has no @Roles metadata: any role of the company can read its configuration', () => {
      const roles = Reflect.getMetadata(
        'roles',
        CompaniesController.prototype.getMyConfiguration,
      );
      expect(roles).toBeUndefined();
      void controller.getMyConfiguration(buildRequest('company-a'));
      expect(tenantConfiguration.get).toHaveBeenCalledWith('company-a');
    });

    it('PATCH requires ADMIN or SUPER_ADMIN', () => {
      const roles = Reflect.getMetadata(
        'roles',
        CompaniesController.prototype.updateMyConfiguration,
      );
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });

    it('PATCH scopes to req.user.companyId and takes the actor from the JWT, never from the body', () => {
      const dto = {
        regional: { timezone: 'America/Bogota' },
        companyId: 'company-b',
      } as any;
      void controller.updateMyConfiguration(buildRequest('company-a'), dto);
      expect(tenantConfiguration.update).toHaveBeenCalledWith(
        'company-a',
        dto,
        { userId: 'user-1', role: 'ADMIN' },
      );
    });
  });

  describe('GET/PATCH /me/settings (compatibilidad) delegan en el mismo motor', () => {
    it('GET → getLegacySettings(companyId)', () => {
      void controller.getMySettings(buildRequest('company-a'));
      expect(tenantConfiguration.getLegacySettings).toHaveBeenCalledWith(
        'company-a',
      );
    });

    it('PATCH → updateLegacySettings(companyId, dto, actor) y sigue exigiendo ADMIN/SUPER_ADMIN', () => {
      const dto = { catalog: { categories: ['Salas'] } };
      void controller.updateMySettings(buildRequest('company-a'), dto);
      expect(tenantConfiguration.updateLegacySettings).toHaveBeenCalledWith(
        'company-a',
        dto,
        { userId: 'user-1', role: 'ADMIN' },
      );
      expect(
        Reflect.getMetadata(
          'roles',
          CompaniesController.prototype.updateMySettings,
        ),
      ).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('GET /me', () => {
    it('resolves the company from req.user.companyId', () => {
      companiesService.findById.mockReturnValue({ id: 'company-a' });
      void controller.getMyCompany(buildRequest('company-a'));
      expect(companiesService.findById).toHaveBeenCalledWith('company-a');
    });

    it('has no @Roles metadata (any authenticated role — incl. AGENT — may read)', () => {
      const roles = Reflect.getMetadata(
        'roles',
        CompaniesController.prototype.getMyCompany,
      );
      expect(roles).toBeUndefined();
    });
  });

  describe('PATCH /me', () => {
    it('updates using req.user.companyId and the dto body', () => {
      const dto = { legalName: 'Empresa A S.A.S', taxId: '900-1' };
      void controller.updateMyCompany(buildRequest('company-a'), dto);
      expect(companiesService.update).toHaveBeenCalledWith('company-a', dto);
    });

    it('never uses a companyId from the body, even if one is smuggled in (A cannot edit B)', () => {
      const dtoWithCompanyId = {
        legalName: 'Attacker',
        companyId: 'company-b',
      };
      void controller.updateMyCompany(
        buildRequest('company-a'),
        dtoWithCompanyId,
      );
      const [calledCompanyId] = companiesService.update.mock.calls[0];
      expect(calledCompanyId).toBe('company-a');
      expect(calledCompanyId).not.toBe('company-b');
    });

    it('requires ADMIN or SUPER_ADMIN (AGENT is rejected by RolesGuard)', () => {
      const roles = Reflect.getMetadata(
        'roles',
        CompaniesController.prototype.updateMyCompany,
      );
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('POST /me/logo', () => {
    it('requires ADMIN or SUPER_ADMIN', () => {
      const roles = Reflect.getMetadata(
        'roles',
        CompaniesController.prototype.uploadLogo,
      );
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('guards', () => {
    it('applies 3 class-level guards including BusinessTenantGuard and RolesGuard', () => {
      const guards = Reflect.getMetadata('__guards__', CompaniesController);
      expect(guards).toHaveLength(3);
      expect(guards[1]).toBe(BusinessTenantGuard);
      expect(guards[2]).toBe(RolesGuard);
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(RolesGuard);
    });
  });
});
