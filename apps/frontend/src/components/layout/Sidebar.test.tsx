import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/store/auth.store';
import { capacidadesDePrueba } from '@/lib/__fixtures__/tenant-capabilities.fixture';

let currentPathname = '/dashboard';

// Capacidades de la empresa (Fase 4): por defecto todo activo y listo. Las
// pruebas de módulos las sustituyen antes de montar.
let capacidades = capacidadesDePrueba();
vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>(
    '@/lib/tenant-capabilities',
  );
  return { ...real, useTenantCapabilities: () => capacidades };
});

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
    capacidades = capacidadesDePrueba();
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

describe('Sidebar — módulos de la empresa (Fase 4)', () => {
  const admin = () =>
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'ADMIN', companyId: 'c1' } as never,
    });
  const enlaces = (nombre: RegExp) => screen.queryAllByRole('link', { name: nombre });

  beforeEach(() => {
    currentPathname = '/dashboard';
    admin();
  });

  it('con todo activo enseña Tareas, Catálogo y Cotizaciones (escritorio y móvil)', () => {
    capacidades = capacidadesDePrueba();
    renderSidebar({ mobileOpen: true, onMobileClose: vi.fn() });

    expect(enlaces(/^Tareas$/)).toHaveLength(2);
    expect(enlaces(/^Catálogo$/)).toHaveLength(2);
    expect(enlaces(/^Cotizaciones$/)).toHaveLength(2);
    // La entrada se llama por el módulo, no por lo que vende la empresa.
    expect(screen.queryByText('Productos')).not.toBeInTheDocument();
  });

  it('un módulo apagado no tiene entrada; los demás siguen', () => {
    capacidades = capacidadesDePrueba({ modules: { catalog: false, quotes: false } });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(enlaces(/^Catálogo$/)).toHaveLength(0);
    expect(enlaces(/^Cotizaciones$/)).toHaveLength(0);
    expect(enlaces(/^Tareas$/).length).toBeGreaterThan(0);
    expect(enlaces(/^Pipeline$/).length).toBeGreaterThan(0);
  });

  it('mientras carga la configuración, ningún módulo opcional aparece y se anuncia la carga', () => {
    // Un módulo prohibido no debe aparecer un instante y desaparecer.
    capacidades = capacidadesDePrueba({ status: 'loading' });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(enlaces(/^Tareas$/)).toHaveLength(0);
    expect(enlaces(/^Catálogo$/)).toHaveLength(0);
    expect(enlaces(/^Cotizaciones$/)).toHaveLength(0);
    expect(enlaces(/^Contactos$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Cargando módulos');
  });

  it('si la configuración falla, la navegación central sigue entera y nada revienta', () => {
    capacidades = capacidadesDePrueba({ status: 'error' });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    for (const n of [/^Inicio$/, /^Contactos$/, /^Pipeline$/, /^Conversaciones$/, /^Empresa$/]) {
      expect(enlaces(n).length).toBeGreaterThan(0);
    }
    expect(enlaces(/^Catálogo$/)).toHaveLength(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('la sección de plataforma no depende de las capacidades de ninguna empresa', () => {
    useAuthStore.setState({
      user: { id: 'u2', name: 'Root', email: 'root@co.test', role: 'SUPER_ADMIN', companyId: null } as never,
    });
    capacidades = capacidadesDePrueba({ status: 'platform' });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(enlaces(/^Empresas$/).length).toBeGreaterThan(0);
    expect(enlaces(/^Auditoría$/).length).toBeGreaterThan(0);
    expect(enlaces(/^Catálogo$/)).toHaveLength(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Sidebar — identidad del producto y de la empresa', () => {
  beforeEach(() => {
    currentPathname = '/dashboard';
    capacidades = capacidadesDePrueba();
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'ADMIN', companyId: 'c1' } as never,
    });
  });

  it('lleva el logotipo TAKTO y enlaza al inicio', () => {
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    const marca = screen.getAllByRole('link', { name: 'TAKTO — ir al inicio' })[0];
    expect(marca).toHaveAttribute('href', '/dashboard');
  });

  it('la empresa va en SU PROPIO bloque, nunca en la misma línea que TAKTO', async () => {
    // El manual prohíbe mezclar las dos marcas. Separarlas en dos franjas es
    // lo que permite enseñar ambas sin incumplirlo.
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    const empresa = await screen.findAllByRole('link', { name: /Tehus Rattan/ });
    expect(empresa[0]).toHaveAttribute('href', '/dashboard/settings/company');
    expect(empresa[0].textContent).not.toContain('TAKTO');
  });

  it('para quien NO administra, el bloque de empresa no finge ser un selector', async () => {
    // Un usuario pertenece a UNA empresa: un desplegable que no despliega
    // nada es peor que no dibujarlo.
    useAuthStore.setState({
      user: { id: 'u2', name: 'Luis', email: 'l@co.test', role: 'AGENT', companyId: 'c1' } as never,
    });
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    expect(await screen.findAllByText('Tehus Rattan')).not.toHaveLength(0);
    expect(
      screen.queryByRole('link', { name: /Tehus Rattan/ }),
    ).not.toBeInTheDocument();
  });

  it('el elemento activo se anuncia como página actual', () => {
    renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    const inicio = screen.getAllByRole('link', { name: 'Inicio' })[0];
    expect(inicio).toHaveAttribute('aria-current', 'page');
  });

  it('el color de la empresa ya NO pinta la navegación del producto', () => {
    // El elemento activo pertenece al producto; la identidad de la empresa
    // vive en su bloque, en sus documentos y en sus pantallas.
    const { container } = renderSidebar({ mobileOpen: false, onMobileClose: vi.fn() });

    const conEstiloDeFondo = container.querySelectorAll('[style*="background-color"]');
    expect(conEstiloDeFondo).toHaveLength(0);
  });
});
