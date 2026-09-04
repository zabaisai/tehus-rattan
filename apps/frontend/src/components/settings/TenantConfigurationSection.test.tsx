import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { TenantConfigurationSection } from './TenantConfigurationSection';
import type { TenantConfiguration } from '@/lib/tenant-configuration';

const config: TenantConfiguration = {
  contractVersion: 1,
  storageVersion: 1,
  identity: {
    industry: 'furniture_decor',
    businessType: 'showroom',
    businessModel: 'products',
    templateVersion: 2,
  },
  regional: { country: 'Colombia', timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' },
  modules: {
    conversations: true,
    contacts: true,
    opportunities: true,
    pipeline: true,
    catalog: true,
    quotes: false,
    tasks: true,
  },
  catalog: { categories: ['Salas'], allowFreeText: true },
  pipeline: {
    id: 'p1',
    name: 'Ventas',
    stages: [
      { id: 's1', name: 'Nuevo', type: 'OPEN', isInitial: true, order: 0 },
      { id: 's2', name: 'Ganado', type: 'WON', isInitial: false, order: 1 },
    ],
  },
  limits: {
    categories: { maxLength: 60, maxCount: 30 },
    regional: {
      country: { maxLength: 80 },
      timezone: { maxLength: 64 },
      currency: { length: 3 },
      locale: { maxLength: 35 },
    },
  },
};

const getMyTenantConfiguration = vi.fn();
const updateMyTenantConfiguration = vi.fn();

vi.mock('@/lib/tenant-configuration', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-configuration')>(
    '@/lib/tenant-configuration',
  );
  return {
    ...real,
    getMyTenantConfiguration: () => getMyTenantConfiguration(),
    updateMyTenantConfiguration: (p: unknown) => updateMyTenantConfiguration(p),
    // El hook real llama a la función INTERNA del módulo; se reconstruye
    // sobre el doble (mismo patrón que CompanyCategoriesEditor.test.tsx).
    useTenantConfiguration: () =>
      useQuery({
        queryKey: real.TENANT_CONFIGURATION_QUERY_KEY,
        queryFn: () => getMyTenantConfiguration(),
      }),
  };
});

function montar(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TenantConfigurationSection readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('TenantConfigurationSection', () => {
  beforeEach(() => {
    getMyTenantConfiguration.mockReset().mockResolvedValue(config);
    updateMyTenantConfiguration.mockReset().mockResolvedValue(config);
  });

  it('muestra «Cargando...» y luego la configuración de LA EMPRESA sin guardar nada', async () => {
    montar();
    expect(screen.getByText('Cargando...')).toBeInTheDocument();

    expect(await screen.findByLabelText(/Zona horaria/)).toHaveValue('America/Bogota');
    expect(screen.getByLabelText(/Moneda/)).toHaveValue('COP');
    expect(screen.getByLabelText(/Idioma y región/)).toHaveValue('es-CO');
    expect(screen.getByLabelText('País')).toHaveValue('Colombia');
    expect(screen.getByLabelText('Vende productos')).toBeChecked();
    expect(screen.getByLabelText('Vende servicios')).not.toBeChecked();
    expect(screen.getByText(/Modelo:/)).toHaveTextContent('Productos');

    // Centrales siempre activos, opcionales editables.
    const centrales = screen.getByRole('list', { name: 'Módulos centrales' });
    expect(centrales).toHaveTextContent('Conversaciones');
    expect(centrales).toHaveTextContent('Oportunidades');
    expect(screen.getAllByText('Siempre activo')).toHaveLength(4);
    expect(screen.getByLabelText(/Catálogo/)).toBeChecked();
    expect(screen.getByLabelText(/Cotizaciones/)).not.toBeChecked();

    // Informativos, no editables.
    const info = screen.getByLabelText('Datos informativos');
    expect(info).toHaveTextContent('furniture_decor');
    expect(info).toHaveTextContent('showroom');
    expect(info).toHaveTextContent('Ventas');
    expect(info).toHaveTextContent('Ganado (Cierre ganado)');

    expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeDisabled();
    expect(updateMyTenantConfiguration).not.toHaveBeenCalled();
  });

  it('muestra el error de carga', async () => {
    getMyTenantConfiguration.mockRejectedValue(new Error('boom'));
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la configuración de la empresa.',
    );
  });

  it('un AGENT (readOnly) ve los valores con los controles deshabilitados y sin botón', async () => {
    montar(true);
    expect(await screen.findByLabelText(/Zona horaria/)).toBeDisabled();
    expect(screen.getByLabelText('Vende productos')).toBeDisabled();
    expect(screen.getByLabelText(/Tareas/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar configuración' })).not.toBeInTheDocument();
    expect(screen.getByText('Solo un administrador puede modificar la configuración.')).toBeInTheDocument();
  });

  it('valida antes de enviar: moneda y zona inválidas marcan su campo y no llaman al servidor', async () => {
    const user = userEvent.setup();
    montar();
    const moneda = await screen.findByLabelText(/Moneda/);
    await user.clear(moneda);
    await user.type(moneda, 'PES');
    const zona = screen.getByLabelText(/Zona horaria/);
    await user.clear(zona);
    await user.type(zona, 'Bogota');

    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));

    expect(zona).toHaveAccessibleDescription(/IANA/);
    expect(zona).toBeInvalid();
    expect(moneda).toBeInvalid();
    expect(updateMyTenantConfiguration).not.toHaveBeenCalled();
  });

  it('no permite dejar ambas ventas en falso y lo dice junto al modelo comercial', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByLabelText('Vende productos'));
    expect(screen.getByText(/Modelo:/)).toHaveTextContent('Sin definir');
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(screen.getByRole('alert')).toHaveTextContent('productos, servicios o ambos');
    expect(updateMyTenantConfiguration).not.toHaveBeenCalled();
  });

  it('envía SOLO lo que cambió (región normalizada, modelo y módulos) y confirma el éxito', async () => {
    const user = userEvent.setup();
    montar();
    const zona = await screen.findByLabelText(/Zona horaria/);
    await user.clear(zona);
    await user.type(zona, 'America/Costa_Rica');
    const moneda = screen.getByLabelText(/Moneda/);
    await user.clear(moneda);
    await user.type(moneda, 'crc');
    const idioma = screen.getByLabelText(/Idioma y región/);
    await user.clear(idioma);
    await user.type(idioma, 'es-cr');
    await user.click(screen.getByLabelText('Vende servicios'));
    await user.click(screen.getByLabelText(/Cotizaciones/));

    expect(screen.getByText(/Modelo:/)).toHaveTextContent('Productos y servicios');

    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));

    await waitFor(() => expect(updateMyTenantConfiguration).toHaveBeenCalledTimes(1));
    expect(updateMyTenantConfiguration).toHaveBeenCalledWith({
      regional: { timezone: 'America/Costa_Rica', currency: 'CRC', locale: 'es-CR' },
      commercial: { sellsServices: true },
      modules: { quotes: true },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Configuración guardada.');
  });

  it('un 400 del servidor se muestra junto al campo que lo causó', async () => {
    const user = userEvent.setup();
    updateMyTenantConfiguration.mockRejectedValue({
      response: {
        status: 400,
        data: {
          message: [
            'regional.locale debe ser una etiqueta de idioma válida (BCP 47), por ejemplo es-CO, es-CR o en-US',
          ],
        },
      },
    });
    montar();
    const idioma = await screen.findByLabelText(/Idioma y región/);
    await user.clear(idioma);
    // Pasa la validación local pero el servidor lo rechaza.
    await user.type(idioma, 'es-419');
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));

    await waitFor(() => expect(updateMyTenantConfiguration).toHaveBeenCalledTimes(1));
    expect(idioma).toBeInvalid();
    expect(idioma).toHaveAccessibleDescription(/BCP 47/);
  });

  it('un 403 se explica como permiso, no como fallo de un campo', async () => {
    const user = userEvent.setup();
    updateMyTenantConfiguration.mockRejectedValue({ response: { status: 403, data: {} } });
    montar();
    await user.click(await screen.findByLabelText(/Tareas/));
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no tienes permiso');
  });
});
