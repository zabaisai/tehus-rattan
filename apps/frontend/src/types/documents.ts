// Frontend-only types for the printable document calculator (Paso 9).
// Nothing here is persisted or connected to the real Quote/QuoteItem API yet —
// see feat(quotes): connect quotes to printable document template for that.

export type DocumentTemplateType = 'SALE_INVOICE' | 'REPAIR' | 'REMISSION';

// Explicit, typed company identity a printable document renders. `name` is the
// only required field (a company always has a registered name); every fiscal
// field is optional and omitted from the document when empty — never replaced
// by a hardcoded/global fallback. This is passed down explicitly so no
// document component infers the company from browser-held state.
export interface DocumentCompanyIdentity {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  // Optional per-company footer/terms text for quotes; omitted when empty.
  quoteFooter?: string | null;
}

export interface DocumentItem {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface DocumentClient {
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
}

export interface DocumentTransport {
  name: string;
  document: string;
  phone: string;
  address: string;
  plate: string;
}

export interface DocumentReceiver {
  name: string;
  phone: string;
}

export interface DocumentTotals {
  subtotal: number;
  advance: number;
  discount: number;
  transport: number;
  others: number;
  iva: number;
  total: number;
}

export interface SaleInvoiceMeta {
  accountNumber: string;
  billingDate: string;
  deliveryDate: string;
  advisor: string;
  observations: string;
}

export interface RepairMeta {
  accountNumber: string;
  date: string;
  advisor: string;
  observations: string;
}

export interface RemissionMeta {
  remissionDate: string;
  paymentMethod: string;
  observations: string;
}
