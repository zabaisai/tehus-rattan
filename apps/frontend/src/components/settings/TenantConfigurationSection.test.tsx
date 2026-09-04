import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { TenantConfigurationSection } from './TenantConfigurationSection';
import {
  TENANT_CONFIGURATION_QUERY_KEY,
  type TenantConfiguration,
} from '@/lib/tenant-configuration';
import { DEFINICIONES_DE_PRUEBA } from '@/lib/__fixtures__/tenant-capabilities.fixture';

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
  capabilities: {
    // Tareas está activo porque la empresa nunca lo desactivó, no porque lo
    // eligiera: la sección lo tiene que decir.
    legacyDefaultsApplied: ['tasks'],
    catalog: { allowedItemTypes: ['PRODUCT'], defaultItemType: 'PRODUCT' },
    definitions: DEFINICIONES_DE_PRUEBA,
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
  render(
    <QueryClientProvider client={client}>
      <TenantConfigurationSection readOnly={readOnly} />
    </QueryClientProvider>,
  );
  return { client };
}

/** Apaga un módulo pasando por el diálogo de confirmación. */
async function apagar(user: ReturnType<typeof userEvent.setup>, etiqueta: RegExp) {
  await user.click(screen.getByLabelText(etiqueta));
  await user.click(await screen.findByRole('button', { name: 'Desactivar' }));
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

  // Teclea en tres campos con un `datalist` de cientos de zonas horarias
  // detrás: en aislamiento tarda <1 s, pero con toda la suite en paralelo ha
  // rozado los 5 s por defecto. El margen es contra la carga, no contra el
  // código.
  it('envía SOLO lo que cambió (región normalizada, modelo y módulos) y confirma el éxito', { timeout: 15_000 }, async () => {
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
    await screen.findByLabelText(/Tareas/);
    await apagar(user, /Tareas/);
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no tienes permiso');
  });

  describe('módulos (Fase 4)', () => {
    it('las etiquetas y descripciones salen de las definiciones que publica el servidor', async () => {
      getMyTenantConfiguration.mockResolvedValue({
        ...config,
        capabilities: {
          ...config.capabilities,
          definitions: config.capabilities.definitions.map((d) =>
            d.key === 'tasks' ? { ...d, label: 'Seguimientos', description: 'TEXTO DEL SERVIDOR' } : d,
          ),
        },
      });
      montar();

      expect(await screen.findByLabelText(/Seguimientos/)).toBeChecked();
      expect(screen.getByText('TEXTO DEL SERVIDOR')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Tareas/)).not.toBeInTheDocument();
    });

    it('un módulo activo solo por compatibilidad lo dice; los elegidos, no', async () => {
      montar();

      const tareas = await screen.findByLabelText(/Tareas/);
      expect(tareas.closest('label')).toHaveTextContent(
        'Activo por compatibilidad: tu empresa nunca lo desactivó.',
      );
      expect(screen.getByLabelText(/Catálogo/).closest('label')).not.toHaveTextContent(
        'Activo por compatibilidad',
      );
    });

    it('apagar un módulo pide confirmación y la casilla no cambia hasta confirmar', async () => {
      const user = userEvent.setup();
      montar();
      const tareas = await screen.findByLabelText(/Tareas/);

      await user.click(tareas);

      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent('Desactivar no borra nada: los datos vuelven al reactivarlo.');
      expect(tareas).toBeChecked();

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(tareas).toBeChecked();
      expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeDisabled();

      await user.click(tareas);
      await user.click(await screen.findByRole('button', { name: 'Desactivar' }));
      await waitFor(() => expect(tareas).not.toBeChecked());
      expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeEnabled();
    });

    it('encender un módulo es inmediato, sin diálogo', async () => {
      const user = userEvent.setup();
      montar();

      await user.click(await screen.findByLabelText(/Cotizaciones/));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Cotizaciones/)).toBeChecked();
    });

    it('avisa cuando Cotizaciones queda activo sin Catálogo', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByLabelText(/Catálogo/);

      expect(screen.queryByRole('note')).not.toBeInTheDocument();

      await user.click(screen.getByLabelText(/Cotizaciones/));
      await apagar(user, /Catálogo/);

      expect(await screen.findByRole('note')).toHaveTextContent(
        'Crear cotizaciones nuevas necesita elementos del catálogo.',
      );
    });

    it('tras guardar, la respuesta del servidor entra en caché ANTES de invalidar la empresa', async () => {
      const user = userEvent.setup();
      const respuesta: TenantConfiguration = {
        ...config,
        modules: { ...config.modules, quotes: true },
      };
      updateMyTenantConfiguration.mockResolvedValue(respuesta);
      const { client } = montar();
      const setQueryData = vi.spyOn(client, 'setQueryData');
      const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

      await user.click(await screen.findByLabelText(/Cotizaciones/));
      await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));

      await waitFor(() => expect(updateMyTenantConfiguration).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(setQueryData).toHaveBeenCalledWith(TENANT_CONFIGURATION_QUERY_KEY, respuesta),
      );
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['company-me'] });
      // Primero la caché canónica, después la invalidación (que vuelve a pedir).
      expect(setQueryData.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateQueries.mock.invocationCallOrder[0],
      );
    });

    it('sin definiciones del servidor, la sección sigue funcionando con las suyas', async () => {
      getMyTenantConfiguration.mockResolvedValue({
        ...config,
        capabilities: { ...config.capabilities, definitions: [] },
      });
      montar();

      expect(await screen.findByLabelText(/Catálogo/)).toBeChecked();
      expect(screen.getByLabelText(/Cotizaciones/)).not.toBeChecked();
      expect(screen.getAllByText('Siempre activo')).toHaveLength(4);
    });
  });
});
