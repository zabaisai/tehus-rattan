import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ProductsPage from './page';
import { Product } from '@/types';

// Pruebas de CARACTERIZACIÓN. Esta pantalla no tenía ninguna, y el incremento
// de búsqueda global necesita que abra la ficha desde `?abrir=`. Antes de
// añadir eso hay que fijar lo que ya hacía, para saber si se rompe.

let parametros = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => parametros,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/products',
}));

// El guard de capacidad se prueba aparte; aquí deja pasar.
vi.mock('@/components/capabilities/RequireTenantCapability', () => ({
  RequireTenantCapability: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const productos: Product[] = [
  {
    id: 'p1',
    name: 'Sala Toscana',
    code: 'C-001',
    sku: 'SKU-1',
    category: 'Salas',
    price: 2450000,
    isActive: true,
  } as Product,
  {
    id: 'p2',
    name: 'Comedor Roble',
    code: 'C-002',
    sku: 'SKU-2',
    category: 'Comedores',
    price: 3800000,
    isActive: true,
  } as Product,
];

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return {
    ...real,
    getProducts: vi.fn(async () => productos),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
  };
});

vi.mock('@/lib/company-settings', async () => {
  const real = await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  const fetchSettings = async () => ({
    version: 2 as const,
    commercial: { sellsProducts: true, sellsServices: false, usesCatalog: true, usesQuotes: false, usesTasks: false },
    catalog: { categories: ['Salas', 'Comedores'], allowFreeText: true as const },
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
  const fetchConfig = async () => null;
  return {
    ...real,
    getMyTenantConfiguration: fetchConfig,
    useTenantConfiguration: () =>
      useQuery({ queryKey: real.TENANT_CONFIGURATION_QUERY_KEY, queryFn: fetchConfig }),
  };
});

vi.mock('@/lib/companies', () => ({
  getMyCompany: vi.fn(async () => ({ id: 'e1', name: 'Muebles del Valle', city: 'Medellín' })),
  resolveCompanyAssetUrl: (u: string) => u,
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductsPage />
    </QueryClientProvider>,
  );
}

describe('Catálogo de productos', () => {
  beforeEach(() => {
    parametros = new URLSearchParams();
  });

  describe('comportamiento existente (caracterización)', () => {
    it('lista los productos de la empresa', async () => {
      montar();

      expect(await screen.findByText('Sala Toscana')).toBeInTheDocument();
      expect(screen.getByText('Comedor Roble')).toBeInTheDocument();
    });

    it('nombra a la empresa conectada, no un inquilino fijo', async () => {
      montar();

      expect(await screen.findByText(/Muebles del Valle/)).toBeInTheDocument();
    });

    it('sin parámetros no abre ninguna ficha', async () => {
      montar();
      await screen.findByText('Sala Toscana');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('el buscador filtra por nombre', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText('Sala Toscana');

      await user.type(screen.getByRole('searchbox', { name: 'Buscar en el catálogo' }), 'comedor');

      await waitFor(() => {
        expect(screen.queryByText('Sala Toscana')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Comedor Roble')).toBeInTheDocument();
    });
  });

  describe('enlace profundo desde la búsqueda global', () => {
    it('`?abrir=` abre la ficha de ESE producto', async () => {
      parametros = new URLSearchParams('abrir=p2');
      montar();

      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent('Editar producto');
      expect(await screen.findByDisplayValue('Comedor Roble')).toBeInTheDocument();
    });

    it('un id que no existe no abre nada ni rompe la pantalla', async () => {
      // Un producto borrado deja enlaces vivos por ahí. Abrir un modal vacío
      // sería peor que no abrir nada.
      parametros = new URLSearchParams('abrir=inexistente');
      montar();

      expect(await screen.findByText('Sala Toscana')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
