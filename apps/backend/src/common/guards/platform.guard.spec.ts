import { ExecutionContext } from '@nestjs/common';
import { PlatformGuard } from './platform.guard';

function createContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PlatformGuard', () => {
  let guard: PlatformGuard;

  beforeEach(() => {
    guard = new PlatformGuard();
  });

  it('allows a SUPER_ADMIN with companyId null', () => {
    const context = createContext({ role: 'SUPER_ADMIN', companyId: null });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a SUPER_ADMIN with a company companyId', () => {
    const context = createContext({
      role: 'SUPER_ADMIN',
      companyId: 'company-a',
    });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects an ADMIN', () => {
    const context = createContext({ role: 'ADMIN', companyId: 'company-a' });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects an AGENT', () => {
    const context = createContext({ role: 'AGENT', companyId: 'company-a' });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects a request without req.user', () => {
    const context = createContext(undefined);

    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects a user without a role', () => {
    const context = createContext({ companyId: null });

    expect(guard.canActivate(context)).toBe(false);
  });
});
