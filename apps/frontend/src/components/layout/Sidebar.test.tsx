import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/store/auth.store';

let currentPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

vi.mock('@/lib/companies', () => ({
  getMyCompany: vi.fn().mockResolvedValue({
    id: 'c1',
    name: 'Tehus Rattan',
    logoUrl: null,
    primaryColor: null,
  }),
  resolveCompanyAssetUrl: (path: string) => path,
}));

function renderSidebar(props: { mobileOpen: boolean; onMobileClose: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar {...props} />
    </QueryClientProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    currentPathname = '/dashboard';
  });

  it('cerrado: fuera de pantalla, y NO es un diálogo', () => {
    // Esta prueba exigía antes que el cajón cerrado siguiera anunciándose como
    // `role="dialog"`. Fijaba el defecto: el cajón se queda montado para poder
    // animarse, así que con el menú cerrado había un diálogo permanente en el
    // árbol de accesibilidad, con `aria-modal="true"` —que le dice al lector de
    // pantalla que el resto de la página no existe— y catorce enlaces
    // enfocables fuera de la vista. En móvil bastaban dos tabulaciones para
    // caer dentro de un menú invisible.
    const { container } = renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(
      screen.queryByRole('dialog', { name: 'Navegación principal' }),
    ).not.toBeInTheDocument();

    const cajon = container.querySelector('[inert]') as HTMLElement;
    expect(cajon).not.toBeNull();
    expect(cajon.className).toContain('-translate-x-full');
  });

  it('cerrado: sus enlaces no se pueden tabular', () => {
    const { container } = renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    // `inert` saca el subárbol del orden de tabulación Y del árbol de
    // accesibilidad, sin romper la transición.
    const cajon = container.querySelector('[inert]') as HTMLElement;
    expect(cajon.querySelectorAll('a[href],button').length).toBeGreaterThan(0);
    expect(cajon.hasAttribute('inert')).toBe(true);
  });

  it('renders the mobile drawer open (on-screen) when mobileOpen is true', () => {
    renderSidebar({ mobileOpen: true, onMobileClose: vi.fn() });
    const drawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    expect(drawer.className).toContain('translate-x-0');
  });

  it('calls onMobileClose when the overlay is clicked', () => {
    const onMobileClose = vi.fn();
    renderSidebar({ mobileOpen: true, onMobileClose });

    const overlay = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(onMobileClose).toHaveBeenCalledTimes(1);
  });

  it('calls onMobileClose on Escape while the drawer is open', () => {
    const onMobileClose = vi.fn();
    renderSidebar({ mobileOpen: true, onMobileClose });
    // The route-sync effect fires once on mount regardless of whether the
    // route "changed" — clear it so this only asserts the Escape behavior.
    onMobileClose.mockClear();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onMobileClose).toHaveBeenCalledTimes(1);
  });

  it('calls onMobileClose when a nav link is clicked (selecting a route closes the drawer)', () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'AGENT', companyId: 'c1' } as never });
    const onMobileClose = vi.fn();
    renderSidebar({ mobileOpen: true, onMobileClose });

    const links = screen.getAllByRole('link', { name: /Contactos/i });
    fireEvent.click(links[links.length - 1]);
    expect(onMobileClose).toHaveBeenCalled();
  });

  it('shows the normal business nav for a regular AGENT', () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'AGENT', companyId: 'c1' } as never });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(screen.getAllByRole('link', { name: /Pipeline/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Plataforma')).not.toBeInTheDocument();
    // AGENT is not ADMIN/SUPER_ADMIN, so WhatsApp/Empresa nav items are gated out.
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument();
  });

  it('shows only the Plataforma section for a platform SUPER_ADMIN (no companyId)', () => {
    useAuthStore.setState({
      user: { id: 'u2', name: 'Root', email: 'root@co.test', role: 'SUPER_ADMIN', companyId: null } as never,
    });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(screen.getAllByText('Plataforma').length).toBeGreaterThan(0);
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
  });

  it('un AGENT no ve Datos: exportar es una copia completa de los datos de los clientes', () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'AGENT', companyId: 'c1' } as never });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(screen.queryByText('Datos')).not.toBeInTheDocument();
  });

  it('un ADMIN sí ve Datos: tiene que poder llevarse su historial sin pedírselo a nadie', () => {
    useAuthStore.setState({ user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'ADMIN', companyId: 'c1' } as never });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(screen.getAllByRole('link', { name: /Datos/i }).length).toBeGreaterThan(0);
    // Pedir la eliminación es suyo; aprobarla y ejecutarla no.
    expect(screen.queryByText('Eliminaciones')).not.toBeInTheDocument();
  });

  it('solo la plataforma ve Eliminaciones', () => {
    useAuthStore.setState({
      user: { id: 'u2', name: 'Root', email: 'root@co.test', role: 'SUPER_ADMIN', companyId: null } as never,
    });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(screen.getAllByRole('link', { name: /Eliminaciones/i }).length).toBeGreaterThan(0);
  });
});
