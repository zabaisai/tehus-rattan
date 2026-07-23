import { Company, QuoteCompanyIdentity } from '@/types';
import { DocumentCompanyIdentity } from '@/types/documents';

// The subset of company fields a printable document needs. Both the full
// Company (GET /companies/me) and the quote's owning-company identity
// (GET /quotes/:id) satisfy this shape.
type CompanyIdentitySource = Pick<
  Company & QuoteCompanyIdentity,
  | 'name'
  | 'legalName'
  | 'taxId'
  | 'email'
  | 'phone'
  | 'address'
  | 'city'
  | 'country'
  | 'website'
  | 'logoUrl'
  | 'quoteFooter'
>;

// Maps a company record to the explicit, typed identity the document
// components render. No inference and no hardcoded fallbacks — the caller
// decides which company (the quote's owner, or the logged-in company).
export function toDocumentCompanyIdentity(
  company: CompanyIdentitySource,
): DocumentCompanyIdentity {
  return {
    name: company.name,
    legalName: company.legalName,
    taxId: company.taxId,
    email: company.email,
    phone: company.phone,
    address: company.address,
    city: company.city,
    country: company.country,
    website: company.website,
    logoUrl: company.logoUrl,
    quoteFooter: company.quoteFooter,
  };
}
