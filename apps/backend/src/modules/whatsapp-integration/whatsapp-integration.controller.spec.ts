import 'reflect-metadata';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('WhatsAppIntegrationController', () => {
  let managementService: any;
  let controller: WhatsAppIntegrationController;

  const safeResponse = {
    id: 'integration-a',
    companyId: 'company-a',
    displayPhoneNumber: '+50255550000',
    phoneNumberId: 'phone-a',
    wabaId: 'waba-a',
    status: 'CONNECTED',
    connectedAt: new Date('2026-01-01'),
    disconnectedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const buildRequest = (companyId: string) => ({
    user: { sub: 'user-1', role: 'ADMIN', companyId },
  });

  beforeEach(() => {
    managementService = {
      getForCompany: jest.fn(),
      connectOrUpdateForCompany: jest.fn(),
      disconnectForCompany: jest.fn(),
    };
    controller = new WhatsAppIntegrationController(managementService);
  });

  describe('GET /me', () => {
    it('calls getForCompany with req.user.companyId', async () => {
      managementService.getForCompany.mockResolvedValue(safeResponse);

      await controller.getMyIntegration(buildRequest('company-a'));

      expect(managementService.getForCompany).toHaveBeenCalledWith(
        'company-a',
      );
    });

    it('returns exactly the safe response from the service', async () => {
      managementService.getForCompany.mockResolvedValue(safeResponse);

      const result = await controller.getMyIntegration(
        buildRequest('company-a'),
      );

      expect(result).toBe(safeResponse);
      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('has no @Roles metadata (any authenticated role can call it)', () => {
      const roles = Reflect.getMetadata(
        'roles',
        WhatsAppIntegrationController.prototype.getMyIntegration,
      );

      expect(roles).toBeUndefined();
    });
  });

  describe('PUT /me', () => {
    const dto = {
      phoneNumberId: 'phone-a',
      accessToken: 'fake-meta-token',
      displayPhoneNumber: '+50255550000',
      wabaId: 'waba-a',
    };

    it('calls connectOrUpdateForCompany with req.user.companyId and the dto', async () => {
      managementService.connectOrUpdateForCompany.mockResolvedValue(
        safeResponse,
      );

      await controller.connectOrUpdateMyIntegration(
        buildRequest('company-a'),
        dto as any,
      );

      expect(
        managementService.connectOrUpdateForCompany,
      ).toHaveBeenCalledWith('company-a', dto);
    });

    it('never uses a companyId from the dto, even if one is present on it', async () => {
      managementService.connectOrUpdateForCompany.mockResolvedValue(
        safeResponse,
      );
      const dtoWithCompanyId = { ...dto, companyId: 'company-attacker' };

      await controller.connectOrUpdateMyIntegration(
        buildRequest('company-victim'),
        dtoWithCompanyId as any,
      );

      const [calledCompanyId] =
        managementService.connectOrUpdateForCompany.mock.calls[0];
      expect(calledCompanyId).toBe('company-victim');
      expect(calledCompanyId).not.toBe('company-attacker');
    });

    it('returns exactly the safe response from the service, without accessTokenEncrypted', async () => {
      managementService.connectOrUpdateForCompany.mockResolvedValue(
        safeResponse,
      );

      const result = await controller.connectOrUpdateMyIntegration(
        buildRequest('company-a'),
        dto as any,
      );

      expect(result).toBe(safeResponse);
      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('has @Roles(ADMIN, SUPER_ADMIN) metadata', () => {
      const roles = Reflect.getMetadata(
        'roles',
        WhatsAppIntegrationController.prototype.connectOrUpdateMyIntegration,
      );

      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('POST /me/disconnect', () => {
    it('calls disconnectForCompany with req.user.companyId', async () => {
      managementService.disconnectForCompany.mockResolvedValue({
        ...safeResponse,
        status: 'DISCONNECTED',
      });

      await controller.disconnectMyIntegration(buildRequest('company-a'));

      expect(managementService.disconnectForCompany).toHaveBeenCalledWith(
        'company-a',
      );
    });

    it('returns exactly the safe response from the service, without accessTokenEncrypted', async () => {
      const disconnected = { ...safeResponse, status: 'DISCONNECTED' };
      managementService.disconnectForCompany.mockResolvedValue(disconnected);

      const result = await controller.disconnectMyIntegration(
        buildRequest('company-a'),
      );

      expect(result).toBe(disconnected);
      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('has @Roles(ADMIN, SUPER_ADMIN) metadata', () => {
      const roles = Reflect.getMetadata(
        'roles',
        WhatsAppIntegrationController.prototype.disconnectMyIntegration,
      );

      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('guards', () => {
    it('applies exactly 2 class-level guards, the second being RolesGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        WhatsAppIntegrationController,
      );

      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(RolesGuard);

      // The first guard is whatever AuthGuard('jwt') returns: a fresh
      // anonymous mixin class generated on every call to AuthGuard(...), not
      // a stable singleton export. Comparing it by identity against a new
      // AuthGuard('jwt') call here would not be a meaningful/stable check,
      // so we only assert a guard class is present and it isn't RolesGuard.
      // The actual JWT enforcement is covered by
      // test/auth-guard.e2e-spec.ts (missing/invalid/expired token cases).
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(RolesGuard);
    });
  });
});
