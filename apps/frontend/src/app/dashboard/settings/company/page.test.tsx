import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompanySettingsPage from './page';
import { useAuthStore } from '@/store/auth.store';
import type { Company } from '@/types';

const getMyCompany = vi.fn();
const updateMyCompany = vi.fn();

vi.mock('@/lib/companies', () => ({
  getMyCompany: () => getMyCompany(),
  updateMyCompany: (payload: unknown) => updateMyCompany(payload),
  uploadCompanyLogo: vi.fn(),
  resolveCompanyAssetUrl: (p: string) => p,
}));
vi.mock('@/lib/onboarding', () => ({ validateLogoFile: () => null }));

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c1', name: 'Empresa A', phone: null, status: 'ACTIVE', slug: null,
    logoUrl: null, secondaryLogoUrl: null, primaryColor: null, accentColor: null,
    backgroundColor: null, businessType: null, city: null, country: null,
    email: null, website: null, description: null, settings: null,
    legalName: null, taxId: 'A-123', address: null, quoteFooter: null,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CompanySettingsPage />
    </QueryClientProvider>,
  );
}

describe('CompanySettingsPage fiscal fields', () => {
  beforeEach(() => {
    updateMyCompany.mockReset();
    updateMyCompany.mockResolvedValue(company());
    useAuthStore.setState({
      user: { id: 'u1', name: 'Ana', email: 'a@co.test', role: 'ADMIN', companyId: 'c1' } as never,
    });
  });

  it('sends null (not undefined) when a fiscal field is cleared, so the clear persists', async () => {
    getMyCompany.mockResolvedValue(company({ taxId: 'A-123' }));
    const user = userEvent.setup();
    renderPage();

    const taxInput = await screen.findByDisplayValue('A-123');
    await user.clear(taxInput);
    await user.click(screen.getByRole('button', { name: /Guardar cambios/i }));

    await waitFor(() => expect(updateMyCompany).toHaveBeenCalledTimes(1));
    const payload = updateMyCompany.mock.calls[0][0];
    expect(payload.taxId).toBeNull();
  });

  it('AGENT cannot manage the company (no fiscal form shown)', async () => {
    useAuthStore.setState({
      user: { id: 'u2', name: 'Agente', email: 'ag@co.test', role: 'AGENT', companyId: 'c1' } as never,
    });
    renderPage();
    expect(
      screen.getByText('No tienes permiso para administrar la configuración de la empresa.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Identidad fiscal/)).not.toBeInTheDocument();
  });
});
