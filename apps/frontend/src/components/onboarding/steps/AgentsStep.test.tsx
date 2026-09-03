import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentsStep } from './AgentsStep';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

describe('AgentsStep — política de contraseñas', () => {
  it('explica una sola vez la política real y aplica el mínimo del backend a cada asesor', () => {
    const { container } = render(
      <AgentsStep
        value={[
          { name: 'Ana', email: '', password: '' },
          { name: 'Luis', email: '', password: '' },
        ]}
        onChange={vi.fn()}
      />,
    );

    // Un solo resumen para todos (no una lista por asesor).
    expect(screen.getAllByText(/Contraseña temporal: al menos 10 caracteres/)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/m[ií]nimo 8/i);
    expect(container.querySelector('input[minlength="8"]')).toBeNull();
    for (const n of [1, 2]) {
      expect(screen.getByLabelText(`Contraseña temporal del asesor ${n}`)).toHaveAttribute(
        'minlength',
        String(PASSWORD_MIN_LENGTH),
      );
    }
  });
});
