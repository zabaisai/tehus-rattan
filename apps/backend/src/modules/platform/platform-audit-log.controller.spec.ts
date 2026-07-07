import 'reflect-metadata';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformGuard } from '../../common/guards/platform.guard';

describe('PlatformAuditLogController', () => {
  let service: any;
  let controller: PlatformAuditLogController;

  beforeEach(() => {
    service = { list: jest.fn() };
    controller = new PlatformAuditLogController(service);
  });

  describe('GET /platform/audit-logs', () => {
    it('delegates to list with action, affectedCompanyId, and actorUserId filters', async () => {
      service.list.mockResolvedValue([]);

      await controller.list('CREATE_COMPANY', 'company-a', 'super-admin-1');

      expect(service.list).toHaveBeenCalledWith({
        action: 'CREATE_COMPANY',
        affectedCompanyId: 'company-a',
        actorUserId: 'super-admin-1',
      });
    });

    it('delegates with undefined filters when none are provided', async () => {
      service.list.mockResolvedValue([]);

      await controller.list();

      expect(service.list).toHaveBeenCalledWith({
        action: undefined,
        affectedCompanyId: undefined,
        actorUserId: undefined,
      });
    });
  });

  describe('guards', () => {
    it('applies exactly 2 class-level guards, the second being PlatformGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PlatformAuditLogController,
      );

      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(PlatformGuard);
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(PlatformGuard);
    });

    it('does not use RolesGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PlatformAuditLogController,
      );

      expect(guards.map((g: any) => g.name)).not.toContain('RolesGuard');
    });
  });
});
