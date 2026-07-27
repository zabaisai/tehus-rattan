import 'reflect-metadata';
import { PlatformActivityController } from './platform-activity.controller';
import { PlatformGuard } from '../../common/guards/platform.guard';

describe('PlatformActivityController', () => {
  let service: any;
  let controller: PlatformActivityController;

  beforeEach(() => {
    service = {
      getSummary: jest.fn(),
      getCompanyActivity: jest.fn(),
      listCompanySessions: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessionsForUser: jest.fn(),
      revokeAllSessionsForCompany: jest.fn(),
    };
    controller = new PlatformActivityController(service);
  });

  const buildRequest = (overrides: Record<string, unknown> = {}) => ({
    user: { sub: 'super-admin-1', role: 'SUPER_ADMIN', companyId: null },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest-test-agent' },
    ...overrides,
  });

  it('delegates GET /platform/activity/summary to getSummary', async () => {
    service.getSummary.mockResolvedValue({});
    await controller.summary();
    expect(service.getSummary).toHaveBeenCalled();
  });

  it('delegates GET /platform/companies/:companyId/activity with the id', async () => {
    service.getCompanyActivity.mockResolvedValue({});
    await controller.companyActivity('company-a');
    expect(service.getCompanyActivity).toHaveBeenCalledWith('company-a');
  });

  it('delegates GET /platform/companies/:companyId/sessions with parsed filters', async () => {
    service.listCompanySessions.mockResolvedValue({});
    await controller.companySessions(
      'company-a',
      '2',
      '10',
      'user-1',
      'ACTIVE',
      'MOBILE',
    );
    expect(service.listCompanySessions).toHaveBeenCalledWith('company-a', {
      page: 2,
      pageSize: 10,
      userId: 'user-1',
      status: 'ACTIVE',
      deviceType: 'MOBILE',
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it('delegates POST /platform/sessions/:sessionId/revoke with the actor from the JWT', async () => {
    service.revokeSession.mockResolvedValue({});
    await controller.revokeSession('session-1', buildRequest());
    expect(service.revokeSession).toHaveBeenCalledWith('session-1', {
      actorUserId: 'super-admin-1',
      actorRole: 'SUPER_ADMIN',
      ipAddress: '127.0.0.1',
      userAgent: 'jest-test-agent',
    });
  });

  it('delegates POST /platform/users/:userId/sessions/revoke-all with the actor', async () => {
    service.revokeAllSessionsForUser.mockResolvedValue({});
    await controller.revokeAllForUser('user-1', buildRequest());
    expect(service.revokeAllSessionsForUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ actorUserId: 'super-admin-1' }),
    );
  });

  it('delegates POST /platform/companies/:companyId/sessions/revoke-all with the actor', async () => {
    service.revokeAllSessionsForCompany.mockResolvedValue({});
    await controller.revokeAllForCompany('company-a', buildRequest());
    expect(service.revokeAllSessionsForCompany).toHaveBeenCalledWith(
      'company-a',
      expect.objectContaining({ actorUserId: 'super-admin-1' }),
    );
  });

  describe('guards', () => {
    it('applies exactly 2 class-level guards, the second being PlatformGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PlatformActivityController,
      );

      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(PlatformGuard);
      expect(typeof guards[0]).toBe('function');
      expect(guards[0]).not.toBe(PlatformGuard);
    });
  });
});
