import 'reflect-metadata';
import { WhatsAppIntegrationController } from './whatsapp-integration.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';

describe('WhatsAppIntegrationController', () => {
  let managementService: any;
  let embeddedSignupService: any;
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
    embeddedSignupService = {
      start: jest.fn(),
      complete: jest.fn(),
      reconnect: jest.fn(),
      getConnectionStatus: jest.fn(),
      disconnectLocal: jest.fn(),
      sendTest: jest.fn(),
    };
    controller = new WhatsAppIntegrationController(
      managementService,
      embeddedSignupService,
    );
  });

  describe('GET /me', () => {
    it('calls getForCompany with req.user.companyId', async () => {
      managementService.getForCompany.mockResolvedValue(safeResponse);

      await controller.getMyIntegration(buildRequest('company-a'));

      expect(managementService.getForCompany).toHaveBeenCalledWith('company-a');
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
        dto,
      );

      expect(managementService.connectOrUpdateForCompany).toHaveBeenCalledWith(
        'company-a',
        dto,
      );
    });

    it('never uses a companyId from the dto, even if one is present on it', async () => {
      managementService.connectOrUpdateForCompany.mockResolvedValue(
        safeResponse,
      );
      const dtoWithCompanyId = { ...dto, companyId: 'company-attacker' };

      await controller.connectOrUpdateMyIntegration(
        buildRequest('company-victim'),
        dtoWithCompanyId,
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
        dto,
      );

      expect(result).toBe(safeResponse);
      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('has @Roles(SUPER_ADMIN) metadata (legacy manual connect is SUPER_ADMIN-only)', () => {
      const roles = Reflect.getMetadata(
        'roles',
        WhatsAppIntegrationController.prototype.connectOrUpdateMyIntegration,
      );

      expect(roles).toEqual(['SUPER_ADMIN']);
    });
  });

  describe('POST /me/disconnect', () => {
    it('routes through the local-disconnect service with req.user.companyId', async () => {
      embeddedSignupService.disconnectLocal.mockResolvedValue({
        ...safeResponse,
        status: 'DISCONNECTED',
      });

      await controller.disconnectMyIntegration(buildRequest('company-a'));

      expect(embeddedSignupService.disconnectLocal).toHaveBeenCalledWith(
        'company-a',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('returns exactly the safe response from the service, without accessTokenEncrypted', async () => {
      const disconnected = { ...safeResponse, status: 'DISCONNECTED' };
      embeddedSignupService.disconnectLocal.mockResolvedValue(disconnected);

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

  describe('Embedded Signup endpoints', () => {
    const buildReq = (companyId: string) => ({
      user: { sub: 'user-1', role: 'ADMIN', companyId },
      headers: { 'user-agent': 'jest' },
    });

    it('GET /me/connection-status calls the service with req.user.companyId and is ADMIN/SUPER_ADMIN only', async () => {
      embeddedSignupService.getConnectionStatus.mockResolvedValue({
        status: 'CONNECTED',
      });
      await controller.getConnectionStatus(buildReq('company-a'));
      expect(embeddedSignupService.getConnectionStatus).toHaveBeenCalledWith(
        'company-a',
      );
      expect(
        Reflect.getMetadata(
          'roles',
          WhatsAppIntegrationController.prototype.getConnectionStatus,
        ),
      ).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });

    it('POST /me/embedded-signup/start passes companyId + an actor derived only from the JWT', async () => {
      embeddedSignupService.start.mockResolvedValue({ state: 's' });
      await controller.startEmbeddedSignup(buildReq('company-a'));
      const [companyId, actor] = embeddedSignupService.start.mock.calls[0];
      expect(companyId).toBe('company-a');
      expect(actor).toMatchObject({ userId: 'user-1', role: 'ADMIN' });
      expect(
        Reflect.getMetadata(
          'roles',
          WhatsAppIntegrationController.prototype.startEmbeddedSignup,
        ),
      ).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });

    it('POST /me/embedded-signup/complete forwards the dto and never a body companyId', async () => {
      embeddedSignupService.complete.mockResolvedValue({ status: 'CONNECTED' });
      const dto = {
        state: 'a'.repeat(64),
        code: 'code',
        phoneNumberId: '123',
        wabaId: '456',
        companyId: 'company-attacker',
      };
      await controller.completeEmbeddedSignup(buildReq('company-victim'), dto);
      const [companyId] = embeddedSignupService.complete.mock.calls[0];
      expect(companyId).toBe('company-victim');
    });

    it('POST /me/reconnect is ADMIN/SUPER_ADMIN only and passes the company from JWT', async () => {
      embeddedSignupService.reconnect.mockResolvedValue({ state: 's' });
      await controller.reconnect(buildReq('company-a'));
      expect(embeddedSignupService.reconnect).toHaveBeenCalledWith(
        'company-a',
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(
        Reflect.getMetadata(
          'roles',
          WhatsAppIntegrationController.prototype.reconnect,
        ),
      ).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('guards', () => {
    it('applies exactly 3 class-level guards: AuthGuard, BusinessTenantGuard, RolesGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        WhatsAppIntegrationController,
      );

      expect(guards).toHaveLength(3);
      expect(guards[1]).toBe(BusinessTenantGuard);
      expect(guards[2]).toBe(RolesGuard);

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
