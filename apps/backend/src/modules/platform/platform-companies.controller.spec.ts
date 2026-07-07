import 'reflect-metadata';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformGuard } from '../../common/guards/platform.guard';

describe('PlatformCompaniesController', () => {
  let service: any;
  let controller: PlatformCompaniesController;

  beforeEach(() => {
    service = {
      listCompanies: jest.fn(),
      getCompanyDetail: jest.fn(),
      createCompany: jest.fn(),
      updateCompanyStatus: jest.fn(),
    };
    controller = new PlatformCompaniesController(service);
  });

  describe('GET /platform/companies', () => {
    it('delegates to listCompanies with search and status', async () => {
      service.listCompanies.mockResolvedValue([]);

      await controller.list('acme', 'ACTIVE');

      expect(service.listCompanies).toHaveBeenCalledWith({
        search: 'acme',
        status: 'ACTIVE',
      });
    });

    it('delegates with undefined filters when none are provided', async () => {
      service.listCompanies.mockResolvedValue([]);

      await controller.list();

      expect(service.listCompanies).toHaveBeenCalledWith({
        search: undefined,
        status: undefined,
      });
    });
  });

  describe('GET /platform/companies/:id', () => {
    it('delegates to getCompanyDetail with the id param', async () => {
      service.getCompanyDetail.mockResolvedValue({ id: 'company-a' });

      await controller.detail('company-a');

      expect(service.getCompanyDetail).toHaveBeenCalledWith('company-a');
    });
  });

  describe('POST /platform/companies', () => {
    it('delegates to createCompany with the dto', async () => {
      const dto = {
        companyName: 'New Co',
        adminName: 'New Admin',
        adminEmail: 'new@co.test',
        adminPassword: 'plain-password',
      };
      service.createCompany.mockResolvedValue({ id: 'company-new' });

      await controller.create(dto as any);

      expect(service.createCompany).toHaveBeenCalledWith(dto);
    });
  });

  describe('PATCH /platform/companies/:id/status', () => {
    it('delegates to updateCompanyStatus with id and status', async () => {
      service.updateCompanyStatus.mockResolvedValue({ id: 'company-a' });

      await controller.updateStatus('company-a', {
        status: 'SUSPENDED',
      } as any);

      expect(service.updateCompanyStatus).toHaveBeenCalledWith(
        'company-a',
        'SUSPENDED',
      );
    });
  });

  describe('guards', () => {
    it('applies exactly 2 class-level guards, the second being PlatformGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PlatformCompaniesController,
      );

      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(PlatformGuard);

      // The first guard is whatever AuthGuard('jwt') returns: a fresh
      // anonymous mixin class generated on every call, not a stable
      // singleton export, so only its presence is asserted here. JWT
      // enforcement itself is covered by test/auth-guard.e2e-spec.ts.
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(PlatformGuard);
    });

    it('does not use RolesGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PlatformCompaniesController,
      );

      expect(guards.map((g: any) => g.name)).not.toContain('RolesGuard');
    });
  });
});
