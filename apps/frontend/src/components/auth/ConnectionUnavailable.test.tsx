import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionUnavailable } from './ConnectionUnavailable';

const retryBootstrap = vi.fn();
vi.mock('@/lib/auth-bootstrap', () => ({ retryBootstrap: () => retryBootstrap() }));

describe('ConnectionUnavailable', () => {
  beforeEach(() => retryBootstrap.mockReset());

  it('shows a connection message and a Retry button — never a login form', () => {
    render(<ConnectionUnavailable />);
    expect(
      screen.getByText('No pudimos conectar con el servidor'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    // It must not offer credential inputs.
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });

  it('Retry re-runs the bootstrap', async () => {
    retryBootstrap.mockResolvedValue(undefined);
    render(<ConnectionUnavailable />);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(retryBootstrap).toHaveBeenCalledTimes(1));
  });
});
