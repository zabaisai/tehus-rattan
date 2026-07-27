import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from './Header';
import { useAuthStore } from '@/store/auth.store';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}));

describe('Header', () => {
  beforeEach(() => {
    pushMock.mockClear();
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana Pérez', email: 'ana@co.test', role: 'AGENT', companyId: 'c1' } as never,
    });
  });

  it('calls onMenuClick when the hamburger button is pressed', () => {
    const onMenuClick = vi.fn();
    render(<Header onMenuClick={onMenuClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('shows the logged-in user name', () => {
    render(<Header onMenuClick={() => {}} />);
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('logs out and redirects to /login even if the API call fails', async () => {
    const { logout } = await import('@/lib/auth');
    vi.mocked(logout).mockRejectedValueOnce(new Error('network down'));

    render(<Header onMenuClick={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(useAuthStore.getState().user).toBeNull();
  });
});
