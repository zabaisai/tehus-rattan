import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineSelector } from './PipelineSelector';
import type { Pipeline } from '@/types';

const pipeline = (id: string, name: string, isDefault = false) =>
  ({ id, name, isDefault, order: 0, isArchived: false, stages: [] }) as unknown as Pipeline;

describe('PipelineSelector', () => {
  it('no dibuja nada cuando solo hay un pipeline', () => {
    // Un desplegable de una sola opción es ruido, y además sugiere que falta
    // algo por elegir.
    const { container } = render(
      <PipelineSelector
        pipelines={[pipeline('p1', 'Ventas', true)]}
        value="p1"
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lista todos los pipelines cuando hay más de uno', () => {
    // Quien tuviera un segundo embudo —posventa, mayoristas— sencillamente no
    // podía verlo: el tablero mostraba siempre el predeterminado.
    render(
      <PipelineSelector
        pipelines={[pipeline('p1', 'Ventas', true), pipeline('p2', 'Posventa')]}
        value="p1"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: /ventas/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /posventa/i })).toBeInTheDocument();
  });

  it('marca cuál es el predeterminado', () => {
    render(
      <PipelineSelector
        pipelines={[pipeline('p1', 'Ventas', true), pipeline('p2', 'Posventa')]}
        value="p1"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('option', { name: 'Ventas (predeterminado)' }),
    ).toBeInTheDocument();
  });

  it('avisa del cambio con el id elegido', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PipelineSelector
        pipelines={[pipeline('p1', 'Ventas', true), pipeline('p2', 'Posventa')]}
        value="p1"
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Pipeline' }), 'p2');

    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('refleja el pipeline activo', () => {
    render(
      <PipelineSelector
        pipelines={[pipeline('p1', 'Ventas', true), pipeline('p2', 'Posventa')]}
        value="p2"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Pipeline' })).toHaveValue('p2');
  });
});
