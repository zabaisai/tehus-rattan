import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequireTenantCapability } from './RequireTenantCapability';
import { useAuthStore } from '@/store/auth.store';
import {
  capacidadesDePrueba,
  configuracionDePrueba,
} from '@/lib/__fixtures__/tenant-capabilities.fixture';
import type { Role } from '@/types';

let capacidades = capacidadesDePrueba();
vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>(
    '@/lib/tenant-capabilities',
  );
  return { ...real, useTenantCapabilities: () => capacidades };
});

const updateMyTenantConfiguration = vi.fn();
vi.mock('@/lib/tenant-configuration', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-configuration')>(
    '@/lib/tenant-configuration',
  );
  return {
    ...real,
    updateMyTenantConfiguration: (p: unknown) => updateMyTenantConfiguration(p),
  };
});

function sesion(role: Role, companyId: string | null = 'c1') {
  useAuthStore.setState({
    user: { id: 'u1', name: 'Ana', email: 'a@co.test', role, companyId } as never,
  });
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <RequireTenantCapability capability="catalog">
        <p>CONTENIDO DEL MÓDULO</p>
      </RequireTenantCapability>
    </QueryClientProvider>,
  );
  return { invalidateQueries };
}

describe('RequireTenantCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesion('ADMIN');
    capacidades = capacidadesDePrueba();
  });

  it('con el módulo activo monta a los hijos y nada más', () => {
    montar();

    expect(screen.getByText('CONTENIDO DEL MÓDULO')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('cargando: esqueleto anunciado, y los hijos NO se montan (sus consultas no corren)', () => {
    capacidades = capacidadesDePrueba({ status: 'loading' });
    montar();

    const estado = screen.getByRole('status');
    expect(estado).toHaveAttribute('aria-busy', 'true');
    expect(estado).toHaveTextContent('Cargando módulos');
    expect(screen.queryByText('CONTENIDO DEL MÓDULO')).not.toBeInTheDocument();
  });

  it('error: lo dice y «Reintentar» vuelve a pedir la configuración', async () => {
    const retry = vi.fn();
    capacidades = capacidadesDePrueba({ status: 'error', retry });
    const user = userEvent.setup();
    montar();

    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo comprobar/);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('CONTENIDO DEL MÓDULO')).not.toBeInTheDocument();
  });

  describe('módulo apagado', () => {
    it('un ADMIN ve la explicación del módulo, el enlace a la configuración y «Activar módulo»', () => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false } });
      montar();

      expect(
        screen.getByRole('heading', { name: 'Este módulo no está activo para tu empresa' }),
      ).toBeInTheDocument();
      // La descripción viene de la definición que publica el servidor.
      expect(
        screen.getByText(/Lista de productos o servicios con precio y categorías/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Ver la configuración de la empresa' }),
      ).toHaveAttribute('href', '/dashboard/settings/company');
      expect(screen.getByRole('button', { name: 'Activar módulo' })).toBeInTheDocument();
      expect(screen.queryByText('CONTENIDO DEL MÓDULO')).not.toBeInTheDocument();
    });

    it('«Activar módulo» hace el PATCH, aplica la respuesta canónica e invalida la empresa', async () => {
      const apply = vi.fn();
      capacidades = capacidadesDePrueba({ modules: { catalog: false }, apply });
      const respuesta = configuracionDePrueba();
      updateMyTenantConfiguration.mockResolvedValue(respuesta);
      const user = userEvent.setup();
      const { invalidateQueries } = montar();

      await user.click(screen.getByRole('button', { name: 'Activar módulo' }));

      await waitFor(() => expect(updateMyTenantConfiguration).toHaveBeenCalledTimes(1));
      expect(updateMyTenantConfiguration).toHaveBeenCalledWith({ modules: { catalog: true } });
      await waitFor(() => expect(apply).toHaveBeenCalledWith(respuesta));
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['company-me'] });
      // Primero la caché canónica, después la invalidación.
      expect(apply.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateQueries.mock.invocationCallOrder[0],
      );
    });

    it('si activar falla, lo dice en el sitio y no redirige', async () => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false } });
      updateMyTenantConfiguration.mockRejectedValue({
        response: { status: 403, data: {} },
      });
      const user = userEvent.setup();
      montar();

      await user.click(screen.getByRole('button', { name: 'Activar módulo' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/permiso/i);
      expect(screen.getByRole('button', { name: 'Activar módulo' })).toBeEnabled();
    });

    it.each<Role>(['AGENT', 'MANAGER'])(
      'un %s ve un aviso neutro: sin enlace de administración ni botón',
      (rol) => {
        sesion(rol);
        capacidades = capacidadesDePrueba({ modules: { catalog: false } });
        montar();

        expect(screen.getByText('Este módulo no está disponible')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Activar módulo' })).not.toBeInTheDocument();
        expect(screen.queryByText('CONTENIDO DEL MÓDULO')).not.toBeInTheDocument();
      },
    );
  });

  it('para la plataforma (SUPER_ADMIN sin empresa) da un mensaje neutro, sin hijos', () => {
    sesion('SUPER_ADMIN', null);
    capacidades = capacidadesDePrueba({ status: 'platform' });
    montar();

    expect(screen.getByText('Esta sección pertenece a una empresa')).toBeInTheDocument();
    expect(screen.queryByText('CONTENIDO DEL MÓDULO')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar módulo' })).not.toBeInTheDocument();
  });
});
