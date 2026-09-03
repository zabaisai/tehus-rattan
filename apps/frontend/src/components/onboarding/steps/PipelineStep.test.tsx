import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineStep, validatePipeline, type PipelineState } from './PipelineStep';

const LIMITS = { maxNameLength: 40, maxCount: 20 };

const ok: PipelineState = {
  name: 'Ventas',
  stages: [
    { name: 'Nuevo lead', type: 'OPEN' },
    { name: 'Contactado', type: 'OPEN' },
    { name: 'Cerrado ganado', type: 'WON' },
    { name: 'Cerrado perdido', type: 'LOST' },
  ],
};

describe('validatePipeline (mismas invariantes que el backend)', () => {
  it('acepta ≥1 OPEN, exactamente 1 WON y 1 LOST', () => {
    expect(validatePipeline(ok, LIMITS)).toBeNull();
  });

  it.each([
    ['sin nombre de pipeline', { ...ok, name: ' ' }, /nombre del pipeline/],
    ['sin etapas', { ...ok, stages: [] }, /al menos una etapa/],
    ['etapa sin nombre', { ...ok, stages: [{ name: ' ', type: 'OPEN' as const }, ...ok.stages.slice(2)] }, /nombre/],
    ['duplicada', { ...ok, stages: [{ name: 'nuevo lead', type: 'OPEN' as const }, ...ok.stages] }, /repetida/],
    ['sin OPEN', { ...ok, stages: ok.stages.slice(2) }, /abierta/],
    ['dos WON', { ...ok, stages: [...ok.stages, { name: 'Ganado 2', type: 'WON' as const }] }, /cierre ganado/],
    ['sin LOST', { ...ok, stages: ok.stages.slice(0, 3) }, /cierre perdido/],
    ['nombre largo', { ...ok, stages: [{ name: 'x'.repeat(41), type: 'OPEN' as const }, ...ok.stages.slice(2)] }, /40 caracteres/],
  ])('rechaza %s', (_label, value, pattern) => {
    expect(validatePipeline(value as PipelineState, LIMITS)).toMatch(pattern);
  });
});

describe('PipelineStep', () => {
  it('muestra Sugerido/Editado y Restaurar solo cuando hay plantilla y cambios', () => {
    const { rerender } = render(
      <PipelineStep value={ok} onChange={() => {}} limits={LIMITS} edited={false} canRestore onRestore={() => {}} />,
    );
    expect(screen.getByText('Sugerido')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restaurar sugerencias/ })).not.toBeInTheDocument();

    rerender(
      <PipelineStep value={ok} onChange={() => {}} limits={LIMITS} edited canRestore onRestore={() => {}} />,
    );
    expect(screen.getByText('Editado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restaurar sugerencias/ })).toBeInTheDocument();

    rerender(
      <PipelineStep value={ok} onChange={() => {}} limits={LIMITS} edited canRestore={false} onRestore={() => {}} />,
    );
    expect(screen.queryByText('Editado')).not.toBeInTheDocument();
  });

  it('cada etapa tiene nombre y tipo accesibles, y agregar inserta una OPEN antes de los cierres', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PipelineStep value={ok} onChange={onChange} limits={LIMITS} edited={false} canRestore onRestore={() => {}} />,
    );

    expect(screen.getByLabelText('Nombre de la etapa 1')).toHaveValue('Nuevo lead');
    expect(screen.getByLabelText('Tipo de la etapa 3')).toHaveValue('WON');

    await user.click(screen.getByRole('button', { name: /Agregar etapa/ }));
    const stages = onChange.mock.calls[0][0].stages;
    expect(stages.map((s: { type: string }) => s.type)).toEqual(['OPEN', 'OPEN', 'OPEN', 'WON', 'LOST']);
    expect(stages[2]).toEqual({ name: '', type: 'OPEN' });
  });

  it('cambiar el tipo y reordenar pasan por onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PipelineStep value={ok} onChange={onChange} limits={LIMITS} edited={false} canRestore onRestore={() => {}} />,
    );

    await user.selectOptions(screen.getByLabelText('Tipo de la etapa 2'), 'WON');
    expect(onChange.mock.calls[0][0].stages[1]).toEqual({ name: 'Contactado', type: 'WON' });

    await user.click(screen.getByRole('button', { name: 'Bajar etapa 1' }));
    expect(onChange.mock.calls[1][0].stages.map((s: { name: string }) => s.name)).toEqual([
      'Contactado',
      'Nuevo lead',
      'Cerrado ganado',
      'Cerrado perdido',
    ]);
    expect(screen.getByRole('button', { name: 'Subir etapa 1' })).toBeDisabled();
  });
});
