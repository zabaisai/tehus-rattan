import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from './ForgotPasswordForm';

const forgotPassword = vi.fn();
vi.mock('@/lib/auth', () => ({
  forgotPassword: (email: string) => forgotPassword(email),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const GENERIC = /Si existe una cuenta asociada a este correo/i;

describe('ForgotPasswordForm', () => {
  beforeEach(() => forgotPassword.mockReset());

  it('has an email field, a submit button and a back-to-login link', () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText('Correo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar instrucciones/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Volver a iniciar sesión/i })).toHaveAttribute('href', '/login');
  });

  it('submits the email and shows the generic message on success', async () => {
    forgotPassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText('Correo'), 'user@co.test');
    await user.click(screen.getByRole('button', { name: /Enviar instrucciones/i }));

    expect(forgotPassword).toHaveBeenCalledWith('user@co.test');
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
  });

  // Note: the anti-enumeration property (identical response for existing vs
  // missing/inactive/suspended accounts) is enforced and tested authoritatively
  // on the backend (test/password-recovery.e2e-spec.ts). At the UI level the
  // handler ALWAYS shows the generic message regardless of the request outcome
  // (it does forgotPassword().catch() then setSent(true)), so success and error
  // are indistinguishable on screen — the success case above covers the render.
});
