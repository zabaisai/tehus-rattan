'use client';

import { DocumentCompanyIdentity } from '@/types/documents';

interface DocumentFooterProps {
  company: DocumentCompanyIdentity;
}

// Builds the fiscal footer line from the OWNING company's data. Each part is
// included only when present, so an empty field leaves no dangling label,
// separator or comma. There is no hardcoded/global fiscal fallback: if the
// company has no fiscal data at all, the footer renders nothing.
export function buildFooterParts(company: DocumentCompanyIdentity): string[] {
  const parts: string[] = [];
  if (company.taxId) parts.push(`NIT: ${company.taxId}`);
  if (company.email) parts.push(`Email: ${company.email}`);
  if (company.phone) parts.push(`Tel: ${company.phone}`);

  const location = [company.address, company.city, company.country]
    .filter(Boolean)
    .join(', ');
  if (location) parts.push(location);

  if (company.website) parts.push(company.website);
  return parts;
}

export function DocumentFooter({ company }: DocumentFooterProps) {
  const parts = buildFooterParts(company);
  if (parts.length === 0) return null;

  return (
    <p className="border-t border-stone-800 pt-1.5 text-center text-[9px] text-stone-600">
      {parts.join('  ·  ')}
    </p>
  );
}
