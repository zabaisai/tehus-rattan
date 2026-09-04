import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import QuotesPage from './page';
import { useAuthStore } from '@/store/auth.store';
import { capacidadesDePrueba } from '@/lib/__fixtures__/tenant-capabilities.fixture';

const getQuotes = vi.fn();
let capacidades = capacidadesDePrueba();

vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>(
    '@/lib/tenant-capabilities',
  );
  return { ...real, useTenantCapabilities: () => capacidades };
});

// El guard de capacidad se prueba aparte; aquí deja pasar.
vi.mock('@/components/capabilities/RequireTenantCapability', () => ({
  RequireTenantCapability: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/quotes', async () => {
  const real = await vi.importActual<typeof import('@/lib/quotes')>(
    '@/lib/quotes',
  );
  return { ...real, getQuotes: (p: unknown) => getQuotes(p), deleteQuote: vi.fn() };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/quotes',
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuotesPage />
    </QueryClientProvider>,
  );
}

function comoRol(role: 'ADMIN' | 'AGENT') {
  useAuthStore.setState({
    user: { id: 'u1', name: 'Quien sea', email: 'q@e.co', role, companyId: 'e1' },
  } as never);
}

describe('QuotesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacidades = capacidadesDePrueba();
    comoRol('ADMIN');
  });

  it('sin cotizaciones lo dice', async () => {
    getQuotes.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText('No hay cotizaciones todavía.'),
    ).toBeInTheDocument();
  });

  it('con un filtro puesto dice que ninguna coincide, no que no existan', async () => {
    getQuotes.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No hay cotizaciones todavía.');

    await user.selectOptions(
      screen.getByLabelText('Filtrar por estado'),
      'DRAFT',
    );

    expect(
      await screen.findByText('Ninguna cotización coincide con el filtro.'),
    ).toBeInTheDocument();
  });

  it('un fallo de carga NO se ve como "no hay cotizaciones"', async () => {
    getQuotes.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText('No hay cotizaciones todavía.'),
    ).not.toBeInTheDocument();
  });

  it('el subtítulo habla de oportunidades y elementos del catálogo, no de «leads con productos»', async () => {
    getQuotes.mockResolvedValue([]);
    renderPage();
    await screen.findByText('No hay cotizaciones todavía.');
    expect(screen.getByText(/Nueva cotización desde una oportunidad/)).toBeInTheDocument();
  });

  describe('cotizaciones activas con el catálogo apagado (Fase 4)', () => {
    beforeEach(() => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false } });
    });

    it('avisa de que no se pueden crear cotizaciones nuevas y, a un administrador, le enlaza Configuración', async () => {
      getQuotes.mockResolvedValue([]);
      renderPage();
      const aviso = await screen.findByTestId('aviso-sin-catalogo');
      expect(aviso).toHaveTextContent(
        'Para crear cotizaciones nuevas, la oportunidad necesita elementos del catálogo. El catálogo está desactivado; un administrador puede activarlo en Configuración.',
      );
      expect(aviso).toHaveAttribute('role', 'status');
      expect(within(aviso).getByRole('link', { name: 'Configuración' })).toHaveAttribute(
        'href',
        '/dashboard/settings/company',
      );
    });

    it('a un asesor le dice lo mismo, pero sin enlace: no puede cambiarlo', async () => {
      comoRol('AGENT');
      getQuotes.mockResolvedValue([]);
      renderPage();
      const aviso = await screen.findByTestId('aviso-sin-catalogo');
      expect(aviso).toHaveTextContent('un administrador puede activarlo en Configuración');
      expect(within(aviso).queryByRole('link')).not.toBeInTheDocument();
    });
  });

  it('con el catálogo activo no hay aviso', async () => {
    getQuotes.mockResolvedValue([]);
    renderPage();
    await screen.findByText('No hay cotizaciones todavía.');
    expect(screen.queryByTestId('aviso-sin-catalogo')).not.toBeInTheDocument();
  });

  it('mientras no se conocen las capacidades, tampoco: no se afirma nada que no se sepa', async () => {
    capacidades = capacidadesDePrueba({ status: 'loading' });
    getQuotes.mockResolvedValue([]);
    renderPage();
    await screen.findByText('No hay cotizaciones todavía.');
    expect(screen.queryByTestId('aviso-sin-catalogo')).not.toBeInTheDocument();
  });
});
