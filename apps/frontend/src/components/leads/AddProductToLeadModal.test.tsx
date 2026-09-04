import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AddProductToLeadModal } from './AddProductToLeadModal';
import type { Product } from '@/types';
import type { CatalogItemType } from '@/lib/tenant-configuration';
import { capacidadesDeCatalogo } from '@/lib/__fixtures__/catalogo.fixture';

const getProducts = vi.fn();
let tipos: CatalogItemType[] = ['PRODUCT', 'SERVICE'];
let capacidades = capacidadesDeCatalogo(tipos);

vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>('@/lib/tenant-capabilities');
  return { ...real, useTenantCapabilities: () => capacidades };
});

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return { ...real, getProducts: (f?: unknown) => getProducts(f) };
});

vi.mock('@/lib/company-settings', async () => {
  const real = await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  const fetchSettings = async () => ({
    version: 2 as const,
    commercial: { sellsProducts: true, sellsServices: true, usesCatalog: true, usesQuotes: true, usesTasks: false },
    catalog: { categories: ['Salas', 'Servicios'], allowFreeText: true as const },
    vertical: null,
    pipelineDefaults: null,
    limits: { categories: { maxLength: 60, maxCount: 30 } },
  });
  return {
    ...real,
    getMyCompanySettings: fetchSettings,
    useCompanySettings: () =>
      useQuery({ queryKey: real.COMPANY_SETTINGS_QUERY_KEY, queryFn: fetchSettings }),
  };
});

const productos = [
  { id: 'p1', name: 'Sala Toscana', category: 'Salas', price: 2450000, isActive: true } as Product,
  { id: 'p2', name: 'Instalación', category: 'Servicios', price: 80000, isActive: true, itemType: 'SERVICE' } as Product,
];

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddProductToLeadModal onClose={vi.fn()} onAdd={vi.fn(async () => undefined)} />
    </QueryClientProvider>,
  );
}

describe('AddProductToLeadModal — producto o servicio', () => {
  beforeEach(() => {
    tipos = ['PRODUCT', 'SERVICE'];
    capacidades = capacidadesDeCatalogo(tipos);
    getProducts.mockReset().mockResolvedValue(productos);
  });

  it('distingue cada elemento con su tipo (un producto anterior sin tipo es Producto) y ambos son seleccionables', async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.getByRole('dialog')).toHaveTextContent('Agregar producto o servicio');

    const sala = (await screen.findByText('Sala Toscana')).closest('label')!;
    const instalacion = screen.getByText('Instalación').closest('label')!;
    expect(within(sala).getByText('Producto')).toBeInTheDocument();
    expect(within(instalacion).getByText('Servicio')).toBeInTheDocument();

    await user.click(within(instalacion).getByRole('radio'));
    expect(within(instalacion).getByRole('radio')).toBeChecked();
    expect(screen.getByLabelText('Precio unitario')).toHaveValue(80000);
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeEnabled();
  });

  it('el filtro por tipo se pide al servidor', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Sala Toscana');
    await user.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'SERVICE');
    await screen.findByText('Sala Toscana'); // sigue mostrando lo que devuelve el doble
    expect(getProducts).toHaveBeenLastCalledWith({ itemType: 'SERVICE' });
  });

  it('las notas de la línea tienen un ejemplo neutro', async () => {
    const user = userEvent.setup();
    montar();
    const fila = (await screen.findByText('Instalación')).closest('label')!;
    await user.click(within(fila).getByRole('radio'));
    expect(screen.getByLabelText(/Notas/)).toHaveAttribute('placeholder', 'Notas para esta línea');
  });

  describe('empresa que vende solo servicios (Fase 4)', () => {
    beforeEach(() => {
      tipos = ['SERVICE'];
      capacidades = capacidadesDeCatalogo(tipos);
    });

    it('titula «Agregar servicio», esconde el filtro por tipo y marca el producto como heredado', async () => {
      montar();
      expect(screen.getByRole('dialog')).toHaveTextContent('Agregar servicio');
      const sala = (await screen.findByText('Sala Toscana')).closest('label')!;
      expect(screen.queryByLabelText('Filtrar por tipo')).not.toBeInTheDocument();
      expect(within(sala).getByText('Heredado')).toBeInTheDocument();
      const instalacion = screen.getByText('Instalación').closest('label')!;
      expect(within(instalacion).queryByText('Heredado')).not.toBeInTheDocument();
      // Un heredado sigue pudiendo cotizarse.
      expect(within(sala).getByRole('radio')).toBeEnabled();
    });

    it('sin catálogo, el vacío habla de servicios', async () => {
      getProducts.mockResolvedValue([]);
      montar();
      expect(
        await screen.findByText('Primero crea o importa servicios en el catálogo.'),
      ).toBeInTheDocument();
    });
  });

  it('empresa que vende solo productos: «Agregar producto»', async () => {
    tipos = ['PRODUCT'];
    capacidades = capacidadesDeCatalogo(tipos);
    montar();
    expect(screen.getByRole('dialog')).toHaveTextContent('Agregar producto');
    await screen.findByText('Sala Toscana');
    expect(screen.queryByLabelText('Filtrar por tipo')).not.toBeInTheDocument();
  });
});
