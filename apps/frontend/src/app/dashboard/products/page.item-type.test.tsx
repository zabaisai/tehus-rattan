import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import ProductsPage from './page';
import type { Product } from '@/types';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/products',
}));

const productos: Product[] = [
  // Sin `itemType`: elemento anterior a la Fase 2 en la caché del cliente.
  { id: 'p1', name: 'Sala Toscana', category: 'Salas', price: 2450000, isActive: true } as Product,
  { id: 'p2', name: 'Instalación a domicilio', category: 'Servicios', price: 80000, isActive: true, itemType: 'SERVICE' } as Product,
];

const getProducts = vi.fn();
const createProduct = vi.fn();
let businessModel: 'products' | 'services' | 'mixed' | null = 'mixed';

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return {
    ...real,
    getProducts: (f?: unknown) => getProducts(f),
    createProduct: (p: unknown) => createProduct(p),
    updateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
  };
});

vi.mock('@/lib/companies', () => ({
  getMyCompany: vi.fn(async () => ({ id: 'e1', name: 'Clínica Vet', city: null })),
  resolveCompanyAssetUrl: (u: string) => u,
}));

vi.mock('@/lib/company-settings', async () => {
  const real = await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  const fetchSettings = async () => ({
    version: 2 as const,
    commercial: { sellsProducts: true, sellsServices: true, usesCatalog: true, usesQuotes: false, usesTasks: false },
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

vi.mock('@/lib/tenant-configuration', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-configuration')>('@/lib/tenant-configuration');
  const fetchConfig = async () => ({
    contractVersion: 1 as const,
    storageVersion: 2 as const,
    identity: { industry: null, businessType: null, businessModel, templateVersion: null },
    regional: { country: null, timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' },
    modules: { conversations: true as const, contacts: true as const, opportunities: true as const, pipeline: true as const, catalog: true, quotes: false, tasks: false },
    catalog: { categories: [], allowFreeText: true as const },
    pipeline: null,
    limits: { categories: { maxLength: 60, maxCount: 30 }, regional: real.DEFAULT_REGIONAL_LIMITS },
  });
  return {
    ...real,
    getMyTenantConfiguration: fetchConfig,
    useTenantConfiguration: () =>
      useQuery({ queryKey: real.TENANT_CONFIGURATION_QUERY_KEY, queryFn: fetchConfig }),
  };
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductsPage />
    </QueryClientProvider>,
  );
}

describe('Catálogo — producto o servicio (Fase 2)', () => {
  beforeEach(() => {
    businessModel = 'mixed';
    getProducts.mockReset().mockResolvedValue(productos);
    createProduct.mockReset().mockResolvedValue(productos[0]);
  });

  it('cada tarjeta lleva su tipo; un elemento anterior sin tipo se muestra como Producto', async () => {
    montar();
    const sala = (await screen.findByText('Sala Toscana')).closest('div')!.parentElement!;
    expect(within(sala).getByText('Producto')).toBeInTheDocument();
    const servicio = screen.getByText('Instalación a domicilio').closest('div')!.parentElement!;
    expect(within(servicio).getByText('Servicio')).toBeInTheDocument();
    // La categoría sigue ahí.
    expect(within(servicio).getByText('Servicios')).toBeInTheDocument();
  });

  it('el filtro Todos / Productos / Servicios se pide al servidor y convive con la categoría', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Sala Toscana');
    expect(getProducts).toHaveBeenLastCalledWith(undefined);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), 'SERVICE');
    await waitFor(() => expect(getProducts).toHaveBeenLastCalledWith({ itemType: 'SERVICE' }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por categoría' }), 'Salas');
    await waitFor(() =>
      expect(getProducts).toHaveBeenLastCalledWith({ category: 'Salas', itemType: 'SERVICE' }),
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), '');
    await waitFor(() => expect(getProducts).toHaveBeenLastCalledWith({ category: 'Salas' }));
  });

  it('al crear, el tipo elegido viaja al servidor (Producto por defecto en una empresa mixta)', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Sala Toscana');
    await user.click(screen.getByRole('button', { name: /Nuevo elemento/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByRole('radio', { name: 'Producto' })).toBeChecked();
    await user.type(within(dialogo).getByLabelText(/Nombre/), 'Mesa');
    await user.type(within(dialogo).getByLabelText(/Precio base/), '100');
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0][0]).toMatchObject({ name: 'Mesa', price: 100, itemType: 'PRODUCT' });
  });

  it('si la empresa vende solo servicios, el modal propone Servicio y lo explica', async () => {
    businessModel = 'services';
    const user = userEvent.setup();
    montar();
    await screen.findByText('Sala Toscana');
    // La configuración llega de forma asíncrona: se espera a que el modal
    // pueda leerla.
    await waitFor(() => expect(screen.getByRole('button', { name: /Nuevo elemento/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Nuevo elemento/ }));
    const dialogo = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialogo).getByRole('radio', { name: 'Servicio' })).toBeChecked());
    expect(within(dialogo).getByText(/se propone «Servicio»/)).toBeInTheDocument();
  });
});
