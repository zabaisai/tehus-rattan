import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANT_CAPABILITY_KEY } from '../../common/decorators/requires-tenant-capability.decorator';
import { TenantCapabilityGuard } from './tenant-capability.guard';
import { ModuleDisabledException } from './tenant-capabilities';

/**
 * El guard decide con la configuración EFECTIVA de la empresa del token.
 * No mira el cuerpo, ni la query, ni los headers: si `req.user.companyId` no
 * está, no hay empresa que consultar.
 */
describe('TenantCapabilityGuard', () => {
  const modules = {
    conversations: true,
    contacts: true,
    opportunities: true,
    pipeline: true,
    catalog: true,
    quotes: false,
    tasks: true,
  };

  function contexto(
    user: Record<string, unknown> | undefined,
    metadata: unknown,
    body: Record<string, unknown> = {},
  ) {
    const reflector = {
      getAllAndOverride: jest.fn(() => metadata),
    } as unknown as Reflector;
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user, body }) }),
    } as unknown as ExecutionContext;
    return { reflector, ctx };
  }

  const configuration = {
    resolveCapabilities: jest.fn(async () => ({ modules })),
  };

  beforeEach(() => configuration.resolveCapabilities.mockClear());

  it('sin metadato deja pasar sin consultar nada', async () => {
    const { reflector, ctx } = contexto({ companyId: 'a' }, undefined);
    const guard = new TenantCapabilityGuard(reflector, configuration as any);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(configuration.resolveCapabilities).not.toHaveBeenCalled();
    expect((reflector.getAllAndOverride as jest.Mock).mock.calls[0][0]).toBe(
      TENANT_CAPABILITY_KEY,
    );
  });

  it('módulo activo → pasa, resolviendo por la empresa del token', async () => {
    const { reflector, ctx } = contexto({ companyId: 'empresa-a' }, 'catalog');
    const guard = new TenantCapabilityGuard(reflector, configuration as any);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(configuration.resolveCapabilities).toHaveBeenCalledWith('empresa-a');
  });

  it('módulo desactivado → 403 MODULE_DISABLED con el módulo', async () => {
    const { reflector, ctx } = contexto({ companyId: 'empresa-a' }, 'quotes');
    const guard = new TenantCapabilityGuard(reflector, configuration as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ModuleDisabledException,
    );
  });

  it('ignora cualquier companyId del cuerpo: solo cuenta el del token', async () => {
    const { reflector, ctx } = contexto({ companyId: 'empresa-a' }, 'quotes', {
      companyId: 'empresa-b',
    });
    const guard = new TenantCapabilityGuard(reflector, configuration as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ModuleDisabledException,
    );
    expect(configuration.resolveCapabilities).toHaveBeenCalledWith('empresa-a');
  });

  it('sin empresa en el token → 403 sin consultar', async () => {
    const { reflector, ctx } = contexto({ companyId: null }, 'catalog');
    const guard = new TenantCapabilityGuard(reflector, configuration as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(configuration.resolveCapabilities).not.toHaveBeenCalled();
  });

  it('un metadato desconocido nunca abre la puerta', async () => {
    const { reflector, ctx } = contexto({ companyId: 'a' }, 'billing');
    const guard = new TenantCapabilityGuard(reflector, configuration as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
