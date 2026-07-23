import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DocumentFooter, buildFooterParts } from './DocumentFooter';
import { DocumentCompanyIdentity } from '@/types/documents';

const full: DocumentCompanyIdentity = {
  name: 'Empresa A',
  legalName: 'Empresa A S.A.S',
  taxId: '900123456-7',
  email: 'ventas@empresa-a.test',
  phone: '+57 300 000 0000',
  address: 'Calle 10 #20-30',
  city: 'Cali',
  country: 'Colombia',
  website: 'https://empresa-a.test',
  logoUrl: null,
  quoteFooter: null,
};

describe('buildFooterParts', () => {
  it('includes every fiscal field that is present', () => {
    const parts = buildFooterParts(full);
    expect(parts).toEqual([
      'NIT: 900123456-7',
      'Email: ventas@empresa-a.test',
      'Tel: +57 300 000 0000',
      'Calle 10 #20-30, Cali, Colombia',
      'https://empresa-a.test',
    ]);
  });

  it('omits empty fields with no dangling labels, commas or separators', () => {
    const parts = buildFooterParts({
      name: 'Empresa Mínima',
      taxId: null,
      email: 'hola@min.test',
      phone: null,
      address: null,
      city: 'Bogotá',
      country: null,
      website: null,
    });
    // Only email + city survive; no "NIT:", no "Tel:", no empty location commas.
    expect(parts).toEqual(['Email: hola@min.test', 'Bogotá']);
    expect(parts.join(' ')).not.toContain('NIT:');
    expect(parts.join(' ')).not.toMatch(/,\s*,/);
  });

  it('returns an empty list when the company has no fiscal data at all', () => {
    expect(buildFooterParts({ name: 'Solo Nombre' })).toEqual([]);
  });

  it('never contains hardcoded Tehus fiscal data', () => {
    const parts = buildFooterParts(full).join(' ');
    expect(parts).not.toContain('901459978');
    expect(parts).not.toContain('rattandelpoblado');
    expect(parts).not.toContain('Tehus');
  });
});

describe('DocumentFooter', () => {
  it('renders nothing when there is no fiscal data', () => {
    const { container } = render(<DocumentFooter company={{ name: 'Solo Nombre' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the assembled fiscal line when data is present', () => {
    const { container } = render(<DocumentFooter company={full} />);
    expect(container.textContent).toContain('NIT: 900123456-7');
    expect(container.textContent).toContain('ventas@empresa-a.test');
  });
});
