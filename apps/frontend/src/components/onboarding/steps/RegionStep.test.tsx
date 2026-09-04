import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionStep } from './RegionStep';
import { DEFAULT_REGIONAL_LIMITS } from '@/lib/tenant-configuration';
import { presetForCountry } from '@/lib/onboarding-regions';

function montar(over: Partial<React.ComponentProps<typeof RegionStep>> = {}) {
  const props: React.ComponentProps<typeof RegionStep> = {
    value: { country: '', timezone: '', currency: '', locale: '' },
    errors: {},
    limits: DEFAULT_REGIONAL_LIMITS,
    edited: false,
    onCountryChange: vi.fn(),
    onFieldChange: vi.fn(),
    onApplyPreset: vi.fn(),
    pendingPreset: null,
    onKeepMine: vi.fn(),
    onApplyPending: vi.fn(),
    ...over,
  };
  render(<RegionStep {...props} />);
  return props;
}

describe('RegionStep', () => {
  it('elegir un país avisa con su preset (zona, moneda e idioma) para que el padre lo aplique', async () => {
    const user = userEvent.setup();
    const props = montar();
    await user.selectOptions(screen.getByLabelText(/País/), 'Costa Rica');
    expect(props.onCountryChange).toHaveBeenCalledWith('Costa Rica', presetForCountry('Costa Rica'));
  });

  it('«Otro país» abre un campo de texto libre y no impone ningún preset', async () => {
    const user = userEvent.setup();
    const props = montar();
    await user.selectOptions(screen.getByLabelText(/^País/), '__other__');
    expect(props.onCountryChange).toHaveBeenCalledWith('', undefined);
    const campo = screen.getByLabelText(/Nombre del país/);
    await user.type(campo, 'N');
    expect(props.onCountryChange).toHaveBeenLastCalledWith('N', undefined);
  });

  it('editar zona, moneda o idioma se marca como edición manual y la moneda va en mayúsculas', async () => {
    const user = userEvent.setup();
    const props = montar({ value: { country: 'Colombia', timezone: 'America/Bogota', currency: 'co', locale: 'es-CO' } });
    await user.type(screen.getByLabelText(/Moneda/), 'p');
    expect(props.onFieldChange).toHaveBeenCalledWith('currency', 'COP');
    expect(screen.getByText('Sugerido por el país')).toBeInTheDocument();
  });

  it('con ediciones muestra «Editado» y permite volver a los valores del país', async () => {
    const user = userEvent.setup();
    const props = montar({
      value: { country: 'Colombia', timezone: 'America/Bogota', currency: 'USD', locale: 'es-CO' },
      edited: true,
    });
    expect(screen.getByText('Editado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Volver a los valores de Colombia/ }));
    expect(props.onApplyPreset).toHaveBeenCalled();
  });

  it('un cambio de país con ediciones pendientes ofrece las dos decisiones explícitas', async () => {
    const user = userEvent.setup();
    const props = montar({
      value: { country: 'Costa Rica', timezone: 'America/Bogota', currency: 'USD', locale: 'es-CO' },
      edited: true,
      pendingPreset: presetForCountry('Costa Rica')!,
    });
    expect(screen.getByRole('group')).toHaveTextContent(/Costa Rica/);
    await user.click(screen.getByRole('button', { name: 'Conservar mis cambios' }));
    expect(props.onKeepMine).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Aplicar los valores del país' }));
    expect(props.onApplyPending).toHaveBeenCalled();
  });

  it('los errores se muestran junto a su campo con aria-invalid', () => {
    montar({
      value: { country: 'Colombia', timezone: 'Bogota', currency: 'PESOS', locale: 'es-CO' },
      errors: { timezone: 'Usa un identificador IANA.', currency: 'Usa un código de tres letras.' },
    });
    expect(screen.getByLabelText(/Zona horaria/)).toBeInvalid();
    expect(screen.getByLabelText(/Zona horaria/)).toHaveAccessibleDescription(/IANA/);
    expect(screen.getByLabelText(/Moneda/)).toBeInvalid();
    expect(screen.getByLabelText(/Idioma/)).not.toBeInvalid();
  });
});
