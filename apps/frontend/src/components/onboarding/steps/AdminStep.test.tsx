import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminStep } from './AdminStep';
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES } from '@/lib/password-policy';

const value = { name: '', email: '', password: '', confirmPassword: '' };

describe('AdminStep — política de contraseñas', () => {
  it('muestra los requisitos REALES (los del backend) y ninguna mención a «mínimo 8»', () => {
    const { container } = render(<AdminStep value={value} onChange={vi.fn()} />);

    const lista = screen.getByRole('list', { name: 'Requisitos de la contraseña' });
    for (const rule of PASSWORD_RULES) {
      expect(lista).toHaveTextContent(rule.label);
    }
    expect(lista).toHaveTextContent(`Al menos ${PASSWORD_MIN_LENGTH} caracteres`);
    expect(container.textContent).not.toMatch(/m[ií]nimo 8/i);
    expect(container.querySelector('input[minlength="8"]')).toBeNull();
    expect(screen.getByLabelText(/^Contraseña/)).toHaveAttribute('minlength', String(PASSWORD_MIN_LENGTH));
    expect(screen.getByLabelText(/Confirmar contraseña/)).toHaveAttribute('minlength', String(PASSWORD_MIN_LENGTH));
  });

  it('la lista se actualiza con lo que se escribe (cumplido / pendiente)', () => {
    const { rerender } = render(<AdminStep value={value} onChange={vi.fn()} />);
    expect(screen.getAllByText('(pendiente)')).toHaveLength(PASSWORD_RULES.length);

    rerender(<AdminStep value={{ ...value, password: 'SuperSecret!123' }} onChange={vi.fn()} />);
    expect(screen.getAllByText('(cumplido)')).toHaveLength(PASSWORD_RULES.length);
  });
});
