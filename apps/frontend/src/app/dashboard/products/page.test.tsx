import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductsPage from './page';

const getMyCompany = vi.fn();
const getProducts = vi.fn();

vi.mock('@/lib/products', () => ({
  getProducts: (...args: unknown[]) => getProducts(...args),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  importProductsFromExcel: vi.fn(),
  PRODUCT_CATEGORIES: ['Sillas', 'Mesas'],
}));

vi.mock('@/lib/companies', () => ({
  getMyCompany: () => getMyCompany(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductsPage />
    </QueryClientProvider>,
  );
}

describe('ProductsPage header (per-company, no hardcoded tenant)', () => {
  beforeEach(() => {
    getProducts.mockResolvedValue([]);
  });

  it('names the logged-in company and its city in the subtitle', async () => {
    getMyCompany.mockResolvedValue({ id: 'c1', name: 'Empresa A', city: 'Cali' });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Productos activos de Empresa A · Cali')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Tehus/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Medellín/)).not.toBeInTheDocument();
  });

  it('omits the city segment when the company has none', async () => {
    getMyCompany.mockResolvedValue({ id: 'c1', name: 'Empresa B', city: null });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Productos activos de Empresa B')).toBeInTheDocument(),
    );
  });
});
