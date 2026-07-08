import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { BusinessTenantGuard } from './business-tenant.guard';

function createContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('BusinessTenantGuard', () => {
  let guard: BusinessTenantGuard;

  beforeEach(() => {
    guard = new BusinessTenantGuard();
  });

  it('allows an ADMIN with a companyId', () => {
    const context = createContext({ role: 'ADMIN', companyId: 'company-a' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an AGENT with a companyId', () => {
    const context = createContext({ role: 'AGENT', companyId: 'company-a' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a global SUPER_ADMIN with companyId null', () => {
    const context = createContext({ role: 'SUPER_ADMIN', companyId: null });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a user without a companyId', () => {
    const context = createContext({ role: 'ADMIN' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an empty-string companyId', () => {
    const context = createContext({ role: 'ADMIN', companyId: '' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a request without req.user', () => {
    const context = createContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('uses a clear, specific error message', () => {
    const context = createContext({ role: 'SUPER_ADMIN', companyId: null });

    try {
      guard.canActivate(context);
      throw new Error('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toBe(
        'Este endpoint requiere un usuario asociado a una empresa',
      );
    }
  });
});
