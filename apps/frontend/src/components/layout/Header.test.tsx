import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header } from './Header';
import { useAuthStore } from '@/store/auth.store';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}));

// The Header hosts the NotificationBell (TanStack Query) — stub the API so no
// real request runs during these tests.
vi.mock('@/lib/notifications', () => ({
  getUnreadCount: vi.fn().mockResolvedValue(0),
  getNotifications: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

// La paleta que abre «Crear» lee las capacidades de la empresa (Fase 4); aquí
// se dan resueltas para que no salga ninguna petición real.
vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>(
    '@/lib/tenant-capabilities',
  );
  const { capacidadesDePrueba } = await import(
    '@/lib/__fixtures__/tenant-capabilities.fixture'
  );
  return { ...real, useTenantCapabilities: () => capacidadesDePrueba() };
});

function renderHeader(props: { onMenuClick: () => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Header {...props} />
    </QueryClientProvider>,
  );
}

describe('Header', () => {
  beforeEach(() => {
    pushMock.mockClear();
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana Pérez', email: 'ana@co.test', role: 'AGENT', companyId: 'c1' } as never,
    });
  });

  it('calls onMenuClick when the hamburger button is pressed', () => {
    const onMenuClick = vi.fn();
    renderHeader({ onMenuClick });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('shows the logged-in user name', () => {
    renderHeader({ onMenuClick: () => {} });
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('logs out and redirects to /login even if the API call fails', async () => {
    const { logout } = await import('@/lib/auth');
    vi.mocked(logout).mockRejectedValueOnce(new Error('network down'));

    renderHeader({ onMenuClick: () => {} });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('Header — acción global «Crear»', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'ADMIN', companyId: 'c1' } as never,
    });
  });

  it('existe y abre la MISMA paleta que Ctrl+K, no un menú aparte', async () => {
    // El panel «Crear rápidamente» del mockup 16 ya vive dentro de la paleta,
    // con sus seis acciones y sus permisos espejados del backend. Un menú
    // propio aquí sería una segunda lista que mantener.
    renderHeader({ onMenuClick: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );
  });

  it('el disparador de búsqueda sigue existiendo junto al de crear', () => {
    renderHeader({ onMenuClick: vi.fn() });

    expect(screen.getByRole('button', { name: /Buscar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });
});
