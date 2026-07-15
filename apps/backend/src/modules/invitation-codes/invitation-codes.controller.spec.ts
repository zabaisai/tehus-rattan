import 'reflect-metadata';
import { InvitationCodesController } from './invitation-codes.controller';
import { PlatformGuard } from '../../common/guards/platform.guard';

describe('InvitationCodesController', () => {
  let service: any;
  let controller: InvitationCodesController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      revoke: jest.fn(),
    };
    controller = new InvitationCodesController(service);
  });

  const buildRequest = (overrides: Record<string, unknown> = {}) => ({
    user: { sub: 'super-admin-1', role: 'SUPER_ADMIN', companyId: null },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest-test-agent' },
    ...overrides,
  });

  describe('POST /admin/invitation-codes', () => {
    it('delegates to create with the dto and the actor from the JWT', async () => {
      const dto = { intendedCompanyName: 'Acme' };
      service.create.mockResolvedValue({ id: 'invitation-1' });

      await controller.create(dto as any, buildRequest());

      expect(service.create).toHaveBeenCalledWith(dto, {
        actorUserId: 'super-admin-1',
        actorRole: 'SUPER_ADMIN',
        ipAddress: '127.0.0.1',
        userAgent: 'jest-test-agent',
      });
    });
  });

  describe('GET /admin/invitation-codes', () => {
    it('delegates to list with the status filter', async () => {
      service.list.mockResolvedValue([]);

      await controller.list('ACTIVE');

      expect(service.list).toHaveBeenCalledWith({ status: 'ACTIVE' });
    });

    it('delegates with an undefined status when none is provided', async () => {
      service.list.mockResolvedValue([]);

      await controller.list();

      expect(service.list).toHaveBeenCalledWith({ status: undefined });
    });
  });

  describe('POST /admin/invitation-codes/:id/revoke', () => {
    it('delegates to revoke with the id and the actor from the JWT', async () => {
      service.revoke.mockResolvedValue({ id: 'invitation-1', status: 'REVOKED' });

      await controller.revoke('invitation-1', buildRequest());

      expect(service.revoke).toHaveBeenCalledWith('invitation-1', {
        actorUserId: 'super-admin-1',
        actorRole: 'SUPER_ADMIN',
        ipAddress: '127.0.0.1',
        userAgent: 'jest-test-agent',
      });
    });
  });

  describe('guards', () => {
    it('applies exactly 2 class-level guards, the second being PlatformGuard', () => {
      const guards = Reflect.getMetadata('__guards__', InvitationCodesController);

      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(PlatformGuard);
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(PlatformGuard);
    });
  });
});
