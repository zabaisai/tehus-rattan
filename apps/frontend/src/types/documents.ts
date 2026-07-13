// Frontend-only types for the printable document calculator (Paso 9).
// Nothing here is persisted or connected to the real Quote/QuoteItem API yet —
// see feat(quotes): connect quotes to printable document template for that.

export type DocumentTemplateType = 'SALE_INVOICE' | 'REPAIR' | 'REMISSION';

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
