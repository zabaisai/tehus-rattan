import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthGate } from './AuthGate';
import { useAuthStore } from '@/store/auth.store';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));
// The unavailable screen pulls in retryBootstrap; stub it so the render is inert.
vi.mock('@/lib/auth-bootstrap', () => ({ retryBootstrap: vi.fn() }));

function setStatus(status: 'bootstrapping' | 'authenticated' | 'anonymous' | 'unavailable') {
  useAuthStore.setState({ status });
}

describe('AuthGate', () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it('shows a loader and NOT private content while bootstrapping', () => {
    setStatus('bootstrapping');
    render(
      <AuthGate>
        <div>PRIVATE</div>
      </AuthGate>,
    );
    expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to /login and hides private content when anonymous', () => {
    setStatus('anonymous');
    render(
      <AuthGate>
        <div>PRIVATE</div>
      </AuthGate>,
    );
    expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('renders children only when authenticated', () => {
    setStatus('authenticated');
    render(
      <AuthGate>
        <div>PRIVATE</div>
      </AuthGate>,
    );
    expect(screen.getByText('PRIVATE')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('when unavailable, shows a retry screen — not private content, not a redirect to /login', () => {
    setStatus('unavailable');
    render(
      <AuthGate>
        <div>PRIVATE</div>
      </AuthGate>,
    );
    expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
    expect(screen.getByText('No pudimos conectar con el servidor')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
