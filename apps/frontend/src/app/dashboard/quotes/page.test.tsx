import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuotesPage from './page';

const getQuotes = vi.fn();

vi.mock('@/lib/quotes', async () => {
  const real = await vi.importActual<typeof import('@/lib/quotes')>(
    '@/lib/quotes',
  );
  return { ...real, getQuotes: (p: unknown) => getQuotes(p), deleteQuote: vi.fn() };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/quotes',
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuotesPage />
    </QueryClientProvider>,
  );
}

describe('QuotesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin cotizaciones lo dice', async () => {
    getQuotes.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText('No hay cotizaciones todavía.'),
    ).toBeInTheDocument();
  });

  it('con un filtro puesto dice que ninguna coincide, no que no existan', async () => {
    getQuotes.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No hay cotizaciones todavía.');

    await user.selectOptions(
      screen.getByLabelText('Filtrar por estado'),
      'DRAFT',
    );

    expect(
      await screen.findByText('Ninguna cotización coincide con el filtro.'),
    ).toBeInTheDocument();
  });

  it('un fallo de carga NO se ve como "no hay cotizaciones"', async () => {
    getQuotes.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText('No hay cotizaciones todavía.'),
    ).not.toBeInTheDocument();
  });
});
