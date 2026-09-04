import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
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
vi.mock('@/lib/tenant-configuration', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-configuration')>('@/lib/tenant-configuration');
  const fetchConfig = async () => ({
      contractVersion: 1 as const,
      storageVersion: 2,
      identity: { industry: null, businessType: null, businessModel: 'products', templateVersion: null },
      regional: { country: null, timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' },
      modules: { conversations: true, contacts: true, opportunities: true, pipeline: true, catalog: true, quotes: false, tasks: false },
      catalog: { categories: [], allowFreeText: true },
      pipeline: null,
      limits: { categories: { maxLength: 60, maxCount: 30 }, regional: real.DEFAULT_REGIONAL_LIMITS },
    });
  return {
    ...real,
    getMyTenantConfiguration: fetchConfig,
    updateMyTenantConfiguration: vi.fn(),
    useTenantConfiguration: () =>
      useQuery({ queryKey: real.TENANT_CONFIGURATION_QUERY_KEY, queryFn: fetchConfig }),
  };
});
vi.mock('@/lib/company-settings', async () => {
  const real = await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  const fetchSettings = async () => ({
    version: 2 as const, commercial: { sellsProducts: true, sellsServices: false, usesCatalog: true, usesQuotes: false, usesTasks: false },
    catalog: { categories: [], allowFreeText: true as const }, vertical: null, pipelineDefaults: null,
    limits: { categories: { maxLength: 60, maxCount: 30 } },
  });
  return {
    ...real,
    getMyCompanySettings: fetchSettings,
    useCompanySettings: () =>
      useQuery({ queryKey: real.COMPANY_SETTINGS_QUERY_KEY, queryFn: fetchSettings }),
  };
});

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

  it('AGENT sees the tenant configuration read-only: disabled controls, no save button', async () => {
    useAuthStore.setState({
      user: { id: 'u2', name: 'Agente', email: 'ag@co.test', role: 'AGENT', companyId: 'c1' } as never,
    });
    renderPage();
    const zona = await screen.findByLabelText(/Zona horaria/);
    expect(zona).toBeDisabled();
    expect(screen.getByLabelText('Vende productos')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar configuración' })).not.toBeInTheDocument();
    expect(screen.getByText('Solo un administrador puede modificar la configuración.')).toBeInTheDocument();
  });

  it('ADMIN sees the tenant configuration with enabled controls and a save button', async () => {
    getMyCompany.mockResolvedValue(company());
    renderPage();
    const zona = await screen.findByLabelText(/Zona horaria/);
    expect(zona).toBeEnabled();
    expect(zona).toHaveValue('America/Bogota');
    expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeInTheDocument();
  });
});
