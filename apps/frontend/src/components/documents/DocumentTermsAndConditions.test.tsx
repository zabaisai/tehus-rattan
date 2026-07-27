import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DocumentTermsAndConditions } from './DocumentTermsAndConditions';

describe('DocumentTermsAndConditions (per-company terms, render safety)', () => {
  it('renders nothing when there are no terms', () => {
    const { container } = render(<DocumentTermsAndConditions terms={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a whitespace-only value', () => {
    const { container } = render(<DocumentTermsAndConditions terms={'   \n  '} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders provided terms as plain, escaped text (no HTML injection)', () => {
    const malicious = '<script>alert(1)</script> Precios <b>sujetos</b> a cambio';
    const { container } = render(<DocumentTermsAndConditions terms={malicious} />);
    // The string is shown verbatim as text; the tags are NOT parsed into
    // elements (React escapes them). No <script>/<b> elements are created.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<b>sujetos</b>');
  });

  it('preserves internal newlines via whitespace-pre-line', () => {
    const { container } = render(
      <DocumentTermsAndConditions terms={'Línea 1\nLínea 2'} />,
    );
    const p = container.querySelector('p');
    expect(p?.className).toContain('whitespace-pre-line');
    expect(p?.textContent).toBe('Línea 1\nLínea 2');
  });
});
