import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardHomePage from './page';
import { useAuthStore } from '@/store/auth.store';

const getMyCompany = vi.fn();

vi.mock('@/lib/analytics', () => ({
  getOverview: vi.fn().mockResolvedValue(null),
  getLeadsByStage: vi.fn().mockResolvedValue([]),
  getAgentPerformance: vi.fn().mockResolvedValue([]),
  getLostReasons: vi.fn().mockResolvedValue([]),
  getOverdueTasksCount: vi.fn().mockResolvedValue(0),
  getPendingConversationsCount: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/companies', () => ({
  getMyCompany: () => getMyCompany(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardHomePage />
    </QueryClientProvider>,
  );
}

describe('DashboardHomePage subtitle (per-company)', () => {
  beforeEach(() => {
    getMyCompany.mockReset();
  });

  it('names the logged-in company for an ADMIN, never a hardcoded tenant', async () => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'ADMIN', companyId: 'c1' } as never,
    });
    getMyCompany.mockResolvedValue({ id: 'c1', name: 'Empresa A' });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Resumen general de Empresa A.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Tehus Rattan/)).not.toBeInTheDocument();
  });

  it('uses a neutral subtitle when there is no company (never queries for a companyless user)', async () => {
    useAuthStore.setState({
      user: { id: 'u2', name: 'Root', email: 'r@co.test', role: 'SUPER_ADMIN', companyId: null } as never,
    });
    renderPage();

    expect(screen.getByText('Resumen general.')).toBeInTheDocument();
    expect(getMyCompany).not.toHaveBeenCalled();
  });
});
