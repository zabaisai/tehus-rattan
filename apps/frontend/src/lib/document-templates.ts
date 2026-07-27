// Static, non-tenant labels for the printable document calculator.
//
// The fiscal footer (NIT/email/phone/address) and the legal terms text used to
// live here as hardcoded, Tehus-specific constants and were printed on every
// company's documents. They have been removed: fiscal identity and terms are
// now per-company (Company.taxId/email/phone/address and Company.quoteFooter)
// and rendered by DocumentFooter / DocumentTermsAndConditions, omitting any
// field the company hasn't set. See docs/COMPANY_FISCAL_IDENTITY.md.

export const DOCUMENT_TEMPLATE_LABELS: Record<
  'SALE_INVOICE' | 'REPAIR' | 'REMISSION',
  string
> = {
  SALE_INVOICE: 'Cotización / Factura de venta',
  REPAIR: 'Reparación',
  REMISSION: 'Remisión',
};

// "Cuenta por cobrar" / "Vence" are the two options visible in the
// Remision sheet's FORMA DE PAGO column; kept as suggestions, not a closed
// enum, since the field is free text in the source.
export const REMISSION_PAYMENT_METHOD_SUGGESTIONS = ['Cuenta por cobrar', 'Vence'];
