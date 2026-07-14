import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Fake handler/class targets so Reflector.getAllAndOverride has something to
// call Reflect.getMetadata against — mirrors what @SetMetadata attaches to a
// real controller method/class, without spinning up a Nest test module.
function createContext(
  user: unknown,
  options: { handlerRoles?: string[]; classRoles?: string[] } = {},
): ExecutionContext {
  class FakeController {}
  function fakeHandler() {}

  if (options.handlerRoles) {
    Reflect.defineMetadata(ROLES_KEY, options.handlerRoles, fakeHandler);
  }
  if (options.classRoles) {
    Reflect.defineMetadata(ROLES_KEY, options.classRoles, FakeController);
  }

  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => fakeHandler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  it('allows an authenticated user when neither method nor class declare @Roles', () => {
    const context = createContext({ role: 'AGENT' });

    expect(guard.canActivate(context)).toBe(true);
  });

  describe('method-level @Roles', () => {
    it('allows ADMIN', () => {
      const context = createContext(
        { role: 'ADMIN' },
        { handlerRoles: ['ADMIN', 'SUPER_ADMIN'] },
      );

      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects AGENT', () => {
      const context = createContext(
        { role: 'AGENT' },
        { handlerRoles: ['ADMIN', 'SUPER_ADMIN'] },
      );

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('class-level @Roles', () => {
    it('allows ADMIN', () => {
      const context = createContext(
        { role: 'ADMIN' },
        { classRoles: ['ADMIN', 'SUPER_ADMIN'] },
      );

      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects AGENT', () => {
      const context = createContext(
        { role: 'AGENT' },
        { classRoles: ['ADMIN', 'SUPER_ADMIN'] },
      );

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('metadata on both class and method', () => {
    it('lets the method-level roles win over the class-level roles', () => {
      // Class only allows ADMIN, method overrides to allow AGENT instead —
      // proves getAllAndOverride prioritizes the handler, per Nest's own
      // documented precedence.
      const agentContext = createContext(
        { role: 'AGENT' },
        { classRoles: ['ADMIN'], handlerRoles: ['AGENT'] },
      );
      expect(guard.canActivate(agentContext)).toBe(true);

      const adminContext = createContext(
        { role: 'ADMIN' },
        { classRoles: ['ADMIN'], handlerRoles: ['AGENT'] },
      );
      expect(guard.canActivate(adminContext)).toBe(false);
    });
  });

  it('rejects when roles are required but the request has no user', () => {
    const context = createContext(undefined, { classRoles: ['ADMIN'] });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects a user with an undefined role', () => {
    const context = createContext({}, { classRoles: ['ADMIN'] });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects a user with a role not present in the required list', () => {
    const context = createContext(
      { role: 'UNKNOWN_ROLE' },
      { classRoles: ['ADMIN', 'SUPER_ADMIN'] },
    );

    expect(guard.canActivate(context)).toBe(false);
  });
});
