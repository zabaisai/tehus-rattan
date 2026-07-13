'use client';

import { useQuery } from '@tanstack/react-query';
import { getMyCompany, resolveCompanyAssetUrl } from '@/lib/companies';

export interface DocumentHeaderField {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
}

interface DocumentHeaderProps {
  title: string;
  fields: DocumentHeaderField[];
}

// Reuses the company's own branding (same source as the Sidebar logo)
// instead of a hardcoded image asset — the Excel's actual logo image is
// intentionally not copied into the repo as an asset file.
export function DocumentHeader({ title, fields }: DocumentHeaderProps) {
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: getMyCompany,
  });

  const logoUrl = company?.logoUrl ? resolveCompanyAssetUrl(company.logoUrl) : null;
  const companyName = company?.name || 'Tehus Rattan';

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
                <input
                  type={field.type ?? 'text'}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="w-32 bg-transparent px-2 py-1 text-xs outline-none"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
