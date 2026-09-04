import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ProductsPage, { NOTA_HEREDADOS } from './page';
import type { Product } from '@/types';
import type { CatalogItemType } from '@/lib/tenant-configuration';
import { capacidadesDeCatalogo } from '@/lib/__fixtures__/catalogo.fixture';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/products',
}));

// El guard de capacidad se prueba aparte; aquí deja pasar para mirar la
// pantalla en sí.
vi.mock('@/components/capabilities/RequireTenantCapability', () => ({
  RequireTenantCapability: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const productos: Product[] = [
  // Sin `itemType`: elemento anterior a la Fase 2 en la caché del cliente.
  { id: 'p1', name: 'Alimento premium', category: 'Alimentos', price: 45000, isActive: true } as Product,
  { id: 'p2', name: 'Consulta general', category: 'Consultas', price: 80000, isActive: true, itemType: 'SERVICE' } as Product,
];

const getProducts = vi.fn();
const createProduct = vi.fn();
const updateProduct = vi.fn();
let tipos: CatalogItemType[] = ['PRODUCT', 'SERVICE'];
let capacidades = capacidadesDeCatalogo(tipos);

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return {
    ...real,
    getProducts: (f?: unknown) => getProducts(f),
    createProduct: (p: unknown) => createProduct(p),
    updateProduct: (id: string, p: unknown) => updateProduct(id, p),
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
    catalog: { categories: ['Alimentos', 'Consultas'], allowFreeText: true as const },
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
  const fetchConfig = async () => capacidades.configuration;
  return {
    ...real,
    getMyTenantConfiguration: fetchConfig,
    useTenantConfiguration: () =>
      useQuery({ queryKey: real.TENANT_CONFIGURATION_QUERY_KEY, queryFn: fetchConfig }),
  };
});

vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>('@/lib/tenant-capabilities');
  return { ...real, useTenantCapabilities: () => capacidades };
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductsPage />
    </QueryClientProvider>,
  );
}

function tarjeta(nombre: string) {
  return screen.getByText(nombre).closest('div')!.parentElement!;
}

describe('Catálogo — producto o servicio según lo que vende la empresa (Fase 4)', () => {
  beforeEach(() => {
    tipos = ['PRODUCT', 'SERVICE'];
    capacidades = capacidadesDeCatalogo(tipos);
    getProducts.mockReset().mockResolvedValue(productos);
    createProduct.mockReset().mockResolvedValue(productos[0]);
    updateProduct.mockReset().mockResolvedValue(productos[0]);
  });

  describe('empresa que vende productos y servicios', () => {
    it('habla en neutro, ofrece el filtro por tipo y no marca nada como heredado', async () => {
      montar();
      await screen.findByText('Alimento premium');

      expect(screen.getByRole('heading', { name: 'Catálogo' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo elemento/ })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Filtrar por tipo' })).toBeInTheDocument();
      expect(screen.queryByText('Heredado')).not.toBeInTheDocument();
      expect(screen.queryByTestId('nota-heredados')).not.toBeInTheDocument();
    });

    it('cada tarjeta lleva su tipo; un elemento anterior sin tipo se muestra como Producto', async () => {
      montar();
      await screen.findByText('Alimento premium');
      expect(within(tarjeta('Alimento premium')).getByText('Producto')).toBeInTheDocument();
      expect(within(tarjeta('Consulta general')).getByText('Servicio')).toBeInTheDocument();
      // La categoría sigue ahí.
      expect(within(tarjeta('Consulta general')).getByText('Consultas')).toBeInTheDocument();
    });

    it('el filtro Todos / Productos / Servicios se pide al servidor y convive con la categoría', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText('Alimento premium');
      expect(getProducts).toHaveBeenLastCalledWith(undefined);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), 'SERVICE');
      await waitFor(() => expect(getProducts).toHaveBeenLastCalledWith({ itemType: 'SERVICE' }));

      await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por categoría' }), 'Alimentos');
      await waitFor(() =>
        expect(getProducts).toHaveBeenLastCalledWith({ category: 'Alimentos', itemType: 'SERVICE' }),
      );

      await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), '');
      await waitFor(() => expect(getProducts).toHaveBeenLastCalledWith({ category: 'Alimentos' }));
    });

    it('al crear, el tipo elegido viaja al servidor (Producto por defecto)', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText('Alimento premium');
      await user.click(screen.getByRole('button', { name: /Nuevo elemento/ }));
      const dialogo = await screen.findByRole('dialog');
      expect(within(dialogo).getByRole('radio', { name: 'Producto' })).toBeChecked();
      await user.type(within(dialogo).getByLabelText(/Nombre/), 'Collar');
      await user.type(within(dialogo).getByLabelText(/Precio base/), '100');
      await user.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
      expect(createProduct.mock.calls[0][0]).toMatchObject({ name: 'Collar', price: 100, itemType: 'PRODUCT' });
    });
  });

  describe('empresa que vende solo servicios', () => {
    beforeEach(() => {
      tipos = ['SERVICE'];
      capacidades = capacidadesDeCatalogo(tipos);
    });

    it('titula «Catálogo de servicios», ofrece «Nuevo servicio» y esconde el filtro por tipo', async () => {
      montar();
      await screen.findByText('Consulta general');

      expect(screen.getByRole('heading', { name: 'Catálogo de servicios' })).toBeInTheDocument();
      expect(screen.getByText(/Servicios activos de Clínica Vet/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo servicio/ })).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Filtrar por tipo' })).not.toBeInTheDocument();
    });

    it('un producto anterior se marca como heredado con texto, y la lista lo explica una vez', async () => {
      montar();
      await screen.findByText('Alimento premium');

      const alimento = tarjeta('Alimento premium');
      expect(within(alimento).getByText('Producto')).toBeInTheDocument();
      expect(within(alimento).getByText('Heredado')).toBeInTheDocument();
      expect(within(tarjeta('Consulta general')).queryByText('Heredado')).not.toBeInTheDocument();
      expect(screen.getByTestId('nota-heredados')).toHaveTextContent(NOTA_HEREDADOS);
    });

    it('al crear no pregunta el tipo: es Servicio, y así viaja', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText('Consulta general');
      await user.click(screen.getByRole('button', { name: /Nuevo servicio/ }));
      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent('Nuevo servicio');
      expect(within(dialogo).queryByRole('radio')).not.toBeInTheDocument();
      await user.type(within(dialogo).getByLabelText(/Nombre/), 'Vacunación');
      await user.type(within(dialogo).getByLabelText(/Precio base/), '60000');
      await user.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
      expect(createProduct.mock.calls[0][0]).toMatchObject({ name: 'Vacunación', itemType: 'SERVICE' });
    });

    it('editar un producto heredado enseña el tipo como texto y NO lo manda al guardar', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText('Alimento premium');
      await user.click(screen.getByRole('button', { name: 'Editar Alimento premium' }));
      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent('Editar producto');
      expect(within(dialogo).getByTestId('tipo-heredado')).toHaveTextContent('Heredado');
      expect(within(dialogo).queryByRole('radio')).not.toBeInTheDocument();

      await user.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
      expect(updateProduct.mock.calls[0][0]).toBe('p1');
      expect(updateProduct.mock.calls[0][1]).not.toHaveProperty('itemType');
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ name: 'Alimento premium' });
    });

    it('sin elementos, el vacío habla de servicios y no de inventario', async () => {
      getProducts.mockResolvedValue([]);
      montar();
      expect(await screen.findByText('Todavía no hay servicios')).toBeInTheDocument();
      expect(screen.getByText(/No necesitas inventario/)).toBeInTheDocument();
      expect(screen.queryByText(/stock/i)).not.toBeInTheDocument();
    });

    it('con una búsqueda sin resultados lo dice, en vez de fingir que el catálogo está vacío', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText('Consulta general');
      await user.type(screen.getByRole('searchbox', { name: 'Buscar en el catálogo' }), 'zzz');
      expect(await screen.findByText('Ningún servicio coincide con la búsqueda.')).toBeInTheDocument();
      expect(screen.queryByText('Todavía no hay servicios')).not.toBeInTheDocument();
    });
  });

  describe('empresa que vende solo productos', () => {
    beforeEach(() => {
      tipos = ['PRODUCT'];
      capacidades = capacidadesDeCatalogo(tipos);
    });

    it('titula «Catálogo de productos» y marca el servicio como heredado', async () => {
      montar();
      await screen.findByText('Consulta general');
      expect(screen.getByRole('heading', { name: 'Catálogo de productos' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo producto/ })).toBeInTheDocument();
      expect(within(tarjeta('Consulta general')).getByText('Heredado')).toBeInTheDocument();
      expect(within(tarjeta('Alimento premium')).queryByText('Heredado')).not.toBeInTheDocument();
    });
  });
});
