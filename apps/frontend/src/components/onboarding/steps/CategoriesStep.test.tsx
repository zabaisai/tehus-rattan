import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesStep } from './CategoriesStep';

const limits = { maxLength: 60, maxCount: 30 };

function montar(value: string[], suggestions = ['Consultas', 'Vacunas']) {
  const onChange = vi.fn();
  render(
    <CategoriesStep
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      limits={limits}
      edited={false}
      canRestore
      onRestore={vi.fn()}
    />,
  );
  return onChange;
}

describe('CategoriesStep — renombrar', () => {
  it('renombra una categoría conservando su posición', async () => {
    const user = userEvent.setup();
    const onChange = montar(['Consultas', 'Vacunas']);
    await user.click(screen.getByRole('button', { name: 'Renombrar categoría Vacunas' }));
    const campo = screen.getByLabelText('Nuevo nombre para Vacunas');
    await user.clear(campo);
    await user.type(campo, 'Vacunación{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Consultas', 'Vacunación']);
  });

  it('no permite renombrar a un duplicado equivalente ni a vacío', async () => {
    const user = userEvent.setup();
    const onChange = montar(['Consultas', 'Vacunas']);
    await user.click(screen.getByRole('button', { name: 'Renombrar categoría Vacunas' }));
    const campo = screen.getByLabelText('Nuevo nombre para Vacunas');
    await user.clear(campo);
    await user.type(campo, ' consultas {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Ya existe una categoría con ese nombre.');
    await user.clear(campo);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un nombre de categoría.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape cancela el renombrado sin cambios', async () => {
    const user = userEvent.setup();
    const onChange = montar(['Consultas']);
    await user.click(screen.getByRole('button', { name: 'Renombrar categoría Consultas' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Nuevo nombre para Consultas')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('la lista en orden muestra exactamente las elegidas y los chips sugeridos marcan su estado', () => {
    montar(['Vacunas', 'Extra']);
    const lista = screen.getByRole('list', { name: 'Categorías elegidas' });
    expect(lista).toHaveTextContent('Vacunas');
    expect(lista).toHaveTextContent('Extra');
    expect(screen.getByRole('button', { name: 'Vacunas' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Consultas' })).toHaveAttribute('aria-pressed', 'false');
  });
});
