import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordForm } from './ResetPasswordForm';

const resetPassword = vi.fn();
const push = vi.fn();
let search = '?token=the-secret-token';

vi.mock('@/lib/auth', () => ({
  resetPassword: (t: string, p: string, c: string) => resetPassword(t, p, c),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}));

const STRONG = 'BrandNew!2027';

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    resetPassword.mockReset();
    push.mockReset();
    search = '?token=the-secret-token';
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('strips the token from the URL and never stores it', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    render(<ResetPasswordForm />);
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(null, '', '/reset-password'));
    // token never persisted anywhere
    expect(JSON.stringify(localStorage)).not.toContain('the-secret-token');
    expect(JSON.stringify(sessionStorage)).not.toContain('the-secret-token');
  });

  it('shows an invalid-link message when there is no token', () => {
    search = '';
    render(<ResetPasswordForm />);
    expect(screen.getByText(/enlace de recuperación es inválido/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Solicitar un nuevo enlace/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('rejects mismatched passwords without calling the API', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText(/^Nueva contraseña/), STRONG);
    await user.type(screen.getByLabelText(/^Confirmar contraseña/), 'Different!2027');
    await user.click(screen.getByRole('button', { name: /Cambiar contraseña/i }));
    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('rejects a weak password (policy) without calling the API', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText(/^Nueva contraseña/), 'weak');
    await user.type(screen.getByLabelText(/^Confirmar contraseña/), 'weak');
    await user.click(screen.getByRole('button', { name: /Cambiar contraseña/i }));
    expect(await screen.findByText(/no cumple los requisitos/i)).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('on success calls the API and redirects to /login?reset=1', async () => {
    resetPassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText(/^Nueva contraseña/), STRONG);
    await user.type(screen.getByLabelText(/^Confirmar contraseña/), STRONG);
    await user.click(screen.getByRole('button', { name: /Cambiar contraseña/i }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('the-secret-token', STRONG, STRONG));
    expect(push).toHaveBeenCalledWith('/login?reset=1');
  });

  it('shows the server message (no technical detail) on an invalid/expired token', async () => {
    resetPassword.mockRejectedValue({ response: { data: { message: 'El enlace de recuperación es inválido o expiró. Solicita uno nuevo.' } } });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText(/^Nueva contraseña/), STRONG);
    await user.type(screen.getByLabelText(/^Confirmar contraseña/), STRONG);
    await user.click(screen.getByRole('button', { name: /Cambiar contraseña/i }));

    expect(await screen.findByText(/inválido o expiró/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the password requirements checklist', () => {
    render(<ResetPasswordForm />);
    expect(screen.getByLabelText('Requisitos de la contraseña')).toBeInTheDocument();
    expect(screen.getByText(/Al menos 10 caracteres/i)).toBeInTheDocument();
  });
});
