import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { QuotePrintableDocument } from './QuotePrintableDocument';
import { Quote, QuoteCompanyIdentity } from '@/types';

// Mock the company asset resolver so the header's logo branch stays inert.
import { vi } from 'vitest';
vi.mock('@/lib/companies', () => ({
  resolveCompanyAssetUrl: (path: string) => path,
}));

function companyIdentity(overrides: Partial<QuoteCompanyIdentity> = {}): QuoteCompanyIdentity {
  return {
    id: 'company-a',
    name: 'Empresa A',
    legalName: 'Empresa A S.A.S',
    taxId: '900111111-1',
    email: 'ventas@empresa-a.test',
    phone: '+57 300 111 1111',
    address: 'Calle A #1-1',
    city: 'Cali',
    country: 'Colombia',
    website: null,
    logoUrl: null,
    quoteFooter: 'Condiciones de la Empresa A.',
    ...overrides,
  };
}

function quoteFixture(company: QuoteCompanyIdentity): Quote {
  return {
    id: 'quote-1',
    number: 'COT-0001',
    title: 'Cotización de prueba',
    status: 'SENT',
    subtotal: 1000,
    discount: 0,
    total: 1000,
    notes: null,
    validUntil: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    leadId: 'lead-1',
    companyId: company.id,
    createdById: null,
    lead: { id: 'lead-1', title: 'Cliente X', status: 'OPEN' },
    items: [
      {
        id: 'qi-1',
        name: 'Silla de ratán',
        description: 'Natural',
        category: 'Sillas',
        quantity: 2,
        unitPrice: 500,
        subtotal: 1000,
        notes: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        quoteId: 'quote-1',
        productId: 'p-1',
      },
    ],
    company,
  };
}

describe('QuotePrintableDocument (multi-tenant identity)', () => {
  it('renders the owning company name and fiscal footer', () => {
    const { container } = render(
      <QuotePrintableDocument quote={quoteFixture(companyIdentity())} lead={null} />,
    );
    expect(container.textContent).toContain('Empresa A');
    expect(container.textContent).toContain('Empresa A S.A.S');
    expect(container.textContent).toContain('NIT: 900111111-1');
    expect(container.textContent).toContain('Condiciones de la Empresa A.');
  });

  it('never prints hardcoded Tehus fiscal data for another tenant', () => {
    const { container } = render(
      <QuotePrintableDocument quote={quoteFixture(companyIdentity())} lead={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('Tehus');
    expect(text).not.toContain('901459978');
    expect(text).not.toContain('rattandelpoblado');
    expect(text).not.toContain('Cra48');
  });

  it('produces distinct documents for two different companies (no cross-tenant contamination)', () => {
    const a = render(
      <QuotePrintableDocument quote={quoteFixture(companyIdentity())} lead={null} />,
    );
    const textA = a.container.textContent ?? '';

    const b = render(
      <QuotePrintableDocument
        quote={quoteFixture(
          companyIdentity({
            id: 'company-b',
            name: 'Empresa B',
            legalName: 'Empresa B Ltda',
            taxId: '900222222-2',
            email: 'ventas@empresa-b.test',
            quoteFooter: 'Condiciones de la Empresa B.',
          }),
        )}
        lead={null}
      />,
    );
    const textB = b.container.textContent ?? '';

    expect(textA).toContain('Empresa A');
    expect(textA).toContain('900111111-1');
    expect(textA).not.toContain('Empresa B');
    expect(textA).not.toContain('900222222-2');

    expect(textB).toContain('Empresa B');
    expect(textB).toContain('900222222-2');
    expect(textB).not.toContain('900111111-1');
  });

  it('omits the fiscal footer entirely when the owning company has no fiscal data', () => {
    const bare = companyIdentity({
      taxId: null,
      email: null,
      phone: null,
      address: null,
      city: null,
      country: null,
      website: null,
      quoteFooter: null,
    });
    const { container } = render(
      <QuotePrintableDocument quote={quoteFixture(bare)} lead={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Empresa A'); // name still heads the document
    expect(text).not.toContain('NIT:');
    expect(text).not.toContain('Email:');
  });
});
