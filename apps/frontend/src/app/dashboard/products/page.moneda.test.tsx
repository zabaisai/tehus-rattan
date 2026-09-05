import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ProductsPage from './page';
import type { Product } from '@/types';
import { capacidadesDeCatalogo } from '@/lib/__fixtures__/catalogo.fixture';

/**
 * FASE 5 — el catálogo enseña los precios en la moneda de LA EMPRESA.
 *
 * Antes había un formateador fijo en pesos colombianos: una empresa mexicana
 * veía sus precios con el símbolo y la separación equivocados. Aquí se
 * comprueba con la pantalla real, no con la función suelta.
 */
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/products',
}));

vi.mock('@/components/capabilities/RequireTenantCapability', () => ({
  RequireTenantCapability: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const productos: Product[] = [
  {
    id: 'p1',
    name: 'Silla de ratán',
    category: 'Muebles',
    price: 1250000,
    isActive: true,
    itemType: 'PRODUCT',
  } as Product,
];

let capacidades = capacidadesDeCatalogo(['PRODUCT']);

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return {
    ...real,
    getProducts: vi.fn(async () => productos),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
  };
});

vi.mock('@/lib/companies', () => ({
  getMyCompany: vi.fn(async () => ({ id: 'e1', name: 'Empresa', city: null })),
  resolveCompanyAssetUrl: (u: string) => u,
}));

vi.mock('@/lib/company-settings', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  const fetchSettings = async () => ({
    version: 2 as const,
    commercial: {
      sellsProducts: true,
      sellsServices: false,
      usesCatalog: true,
      usesQuotes: false,
      usesTasks: false,
    },
    catalog: { categories: ['Muebles'], allowFreeText: true as const },
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
  const real =
    await vi.importActual<typeof import('@/lib/tenant-configuration')>('@/lib/tenant-configuration');
  const fetchConfig = async () => capacidades.configuration;
  return {
    ...real,
    getMyTenantConfiguration: fetchConfig,
    useTenantConfiguration: () =>
      useQuery({ queryKey: real.TENANT_CONFIGURATION_QUERY_KEY, queryFn: fetchConfig }),
  };
});

vi.mock('@/lib/tenant-capabilities', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/tenant-capabilities')>('@/lib/tenant-capabilities');
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

describe('Catálogo — el precio se escribe en la moneda de la empresa (Fase 5)', () => {
  beforeEach(() => {
    capacidades = capacidadesDeCatalogo(['PRODUCT']);
  });

  it('una empresa colombiana ve pesos con separador de miles por punto', async () => {
    montar();
    await screen.findByText('Silla de ratán');

    expect(document.body.textContent).toContain('1.250.000');
  });

  it('una empresa mexicana ve su propia moneda, no la del producto', async () => {
    capacidades = capacidadesDeCatalogo(['PRODUCT'], {
      regional: { country: 'México', currency: 'MXN', locale: 'es-MX' },
    });

    montar();
    await screen.findByText('Silla de ratán');

    // El idioma mexicano separa los miles con coma: la cifra cambia de forma.
    expect(document.body.textContent).toContain('1,250,000');
    expect(document.body.textContent).not.toContain('1.250.000');
  });

  it('una empresa estadounidense ve dólares con dos decimales de separador propio', async () => {
    capacidades = capacidadesDeCatalogo(['PRODUCT'], {
      regional: { country: 'Estados Unidos', currency: 'USD', locale: 'en-US' },
    });

    montar();
    await screen.findByText('Silla de ratán');

    expect(document.body.textContent).toContain('$1,250,000');
  });

  it('una moneda guardada inválida no rompe la pantalla', async () => {
    capacidades = capacidadesDeCatalogo(['PRODUCT'], {
      regional: { currency: 'INVENTADA', locale: 'es-CO' },
    });

    montar();
    await screen.findByText('Silla de ratán');

    expect(document.body.textContent).toContain('INVENTADA');
    expect(document.body.textContent).not.toContain('NaN');
  });
});
