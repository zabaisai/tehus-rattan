import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardLayout from './layout';
import { useAuthStore } from '@/store/auth.store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}));
// El shell solo se comprueba a sí mismo: barra lateral y cabecera tienen sus
// propias pruebas y arrastran react-query, la empresa y la paleta de búsqueda.
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));
vi.mock('@/components/layout/Header', () => ({
  Header: () => <header data-testid="header" />,
}));
vi.mock('@/lib/auth-bootstrap', () => ({ retryBootstrap: vi.fn() }));
// El proveedor de capacidades (Fase 4) arrastra react-query y la consulta de
// configuración; aquí solo se comprueba que ENVUELVE el shell.
vi.mock('@/lib/tenant-capabilities', () => ({
  TenantCapabilitiesProvider: vi.fn(({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )),
}));

function renderShell() {
  return render(
    <DashboardLayout>
      <p>CONTENIDO</p>
    </DashboardLayout>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: 'u1',
      name: 'Ana',
      email: 'a@co.test',
      role: 'ADMIN',
      companyId: 'c1',
    } as never,
  });
});

// jsdom no aplica Tailwind ni calcula maquetación, así que estas pruebas fijan
// las CLASES que producen el comportamiento, no el comportamiento medido. La
// medición real va en la QA de navegador; esto es lo que impide que el arreglo
// se pierda en un refactor sin que nadie se entere hasta la siguiente captura.
describe('shell del dashboard — una sola zona de desplazamiento', () => {
  it('deja exactamente un contenedor desplazable en vertical, y es el main', () => {
    const { container } = renderShell();

    const desplazables = container.querySelectorAll(
      '.overflow-y-auto, .overflow-y-scroll, .overflow-auto, .overflow-scroll',
    );

    expect(desplazables).toHaveLength(1);
    expect(desplazables[0].tagName).toBe('MAIN');
  });

  it('el main es bloque contenedor: sin `relative`, un `sr-only` escapa del recorte y crea una segunda barra en el documento', () => {
    renderShell();

    // `sr-only` es `position: absolute`. Si `main` es `static`, su bloque
    // contenedor pasa a ser el viewport, el recorte de `main` no le aplica y
    // su posición estática —dentro del contenido ya desplazado— se convierte
    // en desbordamiento del documento. Fue exactamente el defecto medido en
    // el Inicio: documento de 1083 px contra un viewport de 695 px.
    expect(screen.getByRole('main').className).toContain('relative');
  });

  it('el shell mide el alto visible con unidades dinámicas y recorta su propio desbordamiento', () => {
    const { container } = renderShell();
    const raiz = container.firstElementChild as HTMLElement;

    expect(raiz.className).toContain('h-dvh');
    // `h-screen` (100vh) es la altura del viewport largo: en un navegador con
    // barra dinámica deja el shell más alto que la pantalla.
    expect(raiz.className).not.toContain('h-screen');
    expect(raiz.className).toContain('overflow-hidden');
  });

  it('el contenido de la página se monta dentro de esa única zona desplazable', () => {
    renderShell();

    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('CONTENIDO');
  });

  it('las capacidades de la empresa envuelven TODO el shell: barra, cabecera y página leen el mismo estado', async () => {
    const { TenantCapabilitiesProvider } = await import('@/lib/tenant-capabilities');
    const proveedor = vi.mocked(TenantCapabilitiesProvider);
    proveedor.mockClear();

    renderShell();

    // Un solo proveedor, montado por encima del shell (que es su único hijo).
    expect(proveedor).toHaveBeenCalledTimes(1);
    const hijo = proveedor.mock.calls[0][0].children as React.ReactElement;
    expect(hijo).toBeTruthy();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
  });
});
