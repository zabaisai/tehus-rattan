'use client';

import { resolveCompanyAssetUrl } from '@/lib/companies';
import { DocumentCompanyIdentity } from '@/types/documents';

export interface DocumentHeaderField {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
}

interface DocumentHeaderProps {
  title: string;
  fields: DocumentHeaderField[];
  // The company whose identity heads the document. Passed explicitly (from the
  // quote's owning company, or the calculator's own company) — never inferred
  // here from browser state.
  company: DocumentCompanyIdentity;
  // Used by QuotePrintableDocument: real quote data is display-only here,
  // never edited from the print view.
  readOnly?: boolean;
}

// Renders the company's own branding (logo + name). The only fallback for the
// name is the company's registered name, which is always present — there is no
// hardcoded/global company name here.
export function DocumentHeader({ title, fields, company, readOnly }: DocumentHeaderProps) {
  const logoUrl = company.logoUrl ? resolveCompanyAssetUrl(company.logoUrl) : null;
  const companyName = company.name;

  return (
    <div className="mb-4 flex items-start justify-between gap-4 border-b-2 border-stone-800 pb-3">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={companyName} className="h-14 w-14 object-contain" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded bg-[#0B0F10] text-[10px] font-bold text-[#C9A25B]">
            {companyName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-stone-900">
            {companyName}
          </p>
          {company.legalName && company.legalName !== companyName && (
            <p className="text-[10px] text-stone-500">{company.legalName}</p>
          )}
          <p className="text-xs font-semibold uppercase tracking-wide text-[#A57014]">
            {title}
          </p>
        </div>
      </div>

      <table className="border border-stone-800 text-xs">
        <tbody>
          {fields.map((field) => (
            <tr key={field.label}>
              <td className="whitespace-nowrap border border-stone-800 bg-white px-2 py-1 font-medium">
                {field.label}
              </td>
              <td className="border border-stone-800 bg-[#E7D7C9] p-0">
                {readOnly ? (
                  <span className="block w-32 px-2 py-1 text-xs">{field.value}</span>
                ) : (
                  <input
                    type={field.type ?? 'text'}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    className="w-32 bg-transparent px-2 py-1 text-xs outline-none"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
