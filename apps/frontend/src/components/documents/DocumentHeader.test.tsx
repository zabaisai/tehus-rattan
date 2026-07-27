import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocumentHeader } from './DocumentHeader';

vi.mock('@/lib/companies', () => ({
  resolveCompanyAssetUrl: (path: string) => path,
}));

describe('DocumentHeader', () => {
  it('renders the explicitly provided company name (no hardcoded fallback)', () => {
    render(
      <DocumentHeader
        company={{ name: 'Empresa A' }}
        title="Cotización"
        fields={[]}
      />,
    );
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.queryByText('Tehus Rattan')).not.toBeInTheDocument();
  });

  it('shows the legal name as a secondary line when it differs from the trade name', () => {
    render(
      <DocumentHeader
        company={{ name: 'Empresa A', legalName: 'Empresa A S.A.S' }}
        title="Cotización"
        fields={[]}
      />,
    );
    expect(screen.getByText('Empresa A S.A.S')).toBeInTheDocument();
  });

  it('falls back to a monogram (not an image) when the company has no logo', () => {
    const { container } = render(
      <DocumentHeader company={{ name: 'Beta Muebles' }} title="Cotización" fields={[]} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('BE')).toBeInTheDocument();
  });
});
