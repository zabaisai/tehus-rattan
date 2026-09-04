import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingProgress } from './OnboardingProgress';

describe('OnboardingProgress', () => {
  const labels = ['Código', 'Empresa', 'Región', 'Confirmación'];

  it('marca el paso actual con aria-current y expone el estado de cada paso en texto', () => {
    render(<OnboardingProgress current={2} labels={labels} />);
    const nav = screen.getByRole('navigation', { name: 'Pasos del registro' });
    const items = nav.querySelectorAll('li');
    expect(items).toHaveLength(4);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[0]).toHaveTextContent('(completado)');
    expect(items[2]).toHaveTextContent('(actual)');
    expect(items[3]).toHaveTextContent('(pendiente)');
  });

  it('en móvil la barra de progreso lleva nombre y valores accesibles', () => {
    render(<OnboardingProgress current={1} labels={labels} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    expect(bar).toHaveAccessibleName('Paso 2 de 4: Empresa');
  });
});
