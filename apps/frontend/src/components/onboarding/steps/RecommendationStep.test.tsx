import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecommendationStep } from './RecommendationStep';
import type { IndustryTemplate } from '@/lib/onboarding-templates';

const industry: IndustryTemplate = {
  key: 'veterinary_pet',
  name: 'Veterinaria y mascotas',
  description: 'Clínicas y pet shops.',
  categorySuggestions: ['Consultas', 'Vacunas', 'Alimentos'],
  businessTypes: [
    {
      key: 'vet_petshop',
      name: 'Veterinaria y pet shop',
      description: 'Consultas y venta de alimentos.',
      businessModel: 'mixed',
      modules: { catalog: true, quotes: false, tasks: true },
      categories: ['Consultas', 'Vacunas', 'Alimentos'],
      pipeline: {
        name: 'Citas y pedidos',
        stages: [
          { name: 'Nueva solicitud', type: 'OPEN' },
          { name: 'Cerrado ganado', type: 'WON' },
          { name: 'Cerrado perdido', type: 'LOST' },
        ],
      },
    },
    {
      key: 'grooming',
      name: 'Grooming',
      description: 'Baño y peluquería.',
      businessModel: 'services',
      modules: { catalog: true, quotes: false, tasks: true },
      categories: ['Grooming'],
      pipeline: { name: 'Citas', stages: [{ name: 'Nuevo', type: 'OPEN' }, { name: 'G', type: 'WON' }, { name: 'P', type: 'LOST' }] },
    },
    {
      key: 'other',
      name: 'Otro / Configurar manualmente',
      description: 'Sin sugerencias.',
      businessModel: 'mixed',
      modules: { catalog: false, quotes: false, tasks: true },
      categories: [],
      pipeline: { name: 'Ventas', stages: [{ name: 'Nuevo', type: 'OPEN' }, { name: 'G', type: 'WON' }, { name: 'P', type: 'LOST' }] },
      manual: true,
    },
  ],
};

function montar(over: Partial<React.ComponentProps<typeof RecommendationStep>> = {}) {
  const props: React.ComponentProps<typeof RecommendationStep> = {
    industry,
    selected: industry.businessTypes[0],
    recommended: industry.businessTypes[0],
    model: 'mixed',
    customBusinessType: '',
    businessTypeMaxLength: 60,
    anyEdited: false,
    onSelectType: vi.fn(),
    onCustomBusinessTypeChange: vi.fn(),
    onResetAll: vi.fn(),
    ...over,
  };
  render(<RecommendationStep {...props} />);
  return props;
}

describe('RecommendationStep', () => {
  it('explica la recomendación: plantilla, motivo, forma de vender, módulos, categorías y etapas en español', () => {
    montar();
    const region = screen.getByRole('region', { name: 'Veterinaria y pet shop' });
    expect(region).toHaveTextContent('Recomendada');
    expect(region).toHaveTextContent(/Porque tu empresa es de veterinaria y mascotas/);
    expect(region).toHaveTextContent('Vendo productos y servicios');
    expect(region).toHaveTextContent('Catálogo de productos o servicios');
    expect(region).toHaveTextContent('Consultas, Vacunas, Alimentos');
    expect(region).toHaveTextContent('Nueva solicitud');
    expect(region).toHaveTextContent('Cerrado ganado (cierre ganado)');
    expect(region.textContent).not.toMatch(/PRODUCT|SERVICE|vertical|pipelineDefaults/);
    expect(screen.getByRole('radio', { name: /Veterinaria y pet shop/ })).toBeChecked();
  });

  it('permite elegir otra plantilla o configurar manualmente', async () => {
    const user = userEvent.setup();
    const props = montar();
    await user.click(screen.getByRole('radio', { name: /Grooming/ }));
    expect(props.onSelectType).toHaveBeenCalledWith('grooming');
    await user.click(screen.getByRole('radio', { name: /Configurar manualmente/ }));
    expect(props.onSelectType).toHaveBeenCalledWith('other');
  });

  it('una plantilla distinta de la recomendada se marca «Elegida por ti» y la recomendada sigue señalada', () => {
    montar({ selected: industry.businessTypes[1] });
    expect(screen.getByRole('region', { name: 'Grooming' })).toHaveTextContent('Elegida por ti');
    expect(screen.getByRole('radio', { name: /Veterinaria y pet shop/ })).toHaveAccessibleName(/Recomendada/);
  });

  it('con «Otro» pide la descripción del tipo de negocio', async () => {
    const user = userEvent.setup();
    const props = montar({ selected: industry.businessTypes[2] });
    const campo = screen.getByLabelText(/Describe tu tipo de negocio/);
    await user.type(campo, 'D');
    expect(props.onCustomBusinessTypeChange).toHaveBeenCalledWith('D');
  });

  it('«Restablecer recomendaciones» solo aparece cuando hay algo editado', async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.queryByRole('button', { name: /Restablecer recomendaciones/ })).not.toBeInTheDocument();
    const props = montar({ anyEdited: true });
    await user.click(screen.getByRole('button', { name: /Restablecer recomendaciones/ }));
    expect(props.onResetAll).toHaveBeenCalled();
  });
});
