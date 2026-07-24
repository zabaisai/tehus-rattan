'use client';

import { PrintableDocumentShell } from './PrintableDocumentShell';
import { DocumentHeader } from './DocumentHeader';
import { DocumentClientInfo } from './DocumentClientInfo';
import { DocumentItemsEditor } from './DocumentItemsEditor';
import { DocumentTotalsBlock } from './DocumentTotalsBlock';
import { DocumentTermsAndConditions } from './DocumentTermsAndConditions';
import { DocumentSignatureBlock } from './DocumentSignatureBlock';
import { DocumentFooter } from './DocumentFooter';
import { Quote, LeadDetail } from '@/types';
import { DocumentCompanyIdentity, DocumentItem } from '@/types/documents';
import { toDocumentCompanyIdentity } from '@/lib/document-company';

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function noop() {
  // DocumentHeader/DocumentClientInfo/DocumentItemsEditor always take an
  // onChange — readOnly just means nothing ever calls it.
}

interface QuotePrintableDocumentProps {
  quote: Quote;
  lead: LeadDetail | null;
}

// Renders a real Quote as the same SaleInvoiceTemplate-style printable
// document the calculator uses — but read-only, and built from the actual
// QuoteItem snapshot rather than local calculator state. Reparación and
// Remisión aren't wired to any real data source yet (only quotes exist on
// the backend), so this only ever renders the sale-invoice layout.
export function QuotePrintableDocument({ quote, lead }: QuotePrintableDocumentProps) {
  // The document renders the identity of the company that OWNS the quote
  // (resolved server-side and returned on GET /quotes/:id), never the viewer's
  // own company or a hardcoded footer. The only name fallback is the owning
  // company's registered name, which is always present.
  const company: DocumentCompanyIdentity = quote.company
    ? toDocumentCompanyIdentity(quote.company)
    : { name: '' };

  // QuoteItem is already the snapshot taken when the quote was created —
  // reading it here, never the live Product, is what keeps a sent quote
  // showing what the client actually saw even if the catalog changes later.
  const items: DocumentItem[] = (quote.items ?? []).map((item) => ({
    id: item.id,
    // QuoteItem has no snapshotted code/sku field (only name/description/
    // category/quantity/unitPrice/notes) — productId is the closest thing
    // available, and is blank when the item had no catalog product at all.
    code: item.productId ?? '',
    description: [item.name, item.category, item.notes].filter(Boolean).join(' — '),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.subtotal,
  }));

  const clientName = lead?.contact.name || quote.lead.title;
  const clientPhone = lead?.contact.phone || '';
  const clientEmail = lead?.contact.email || '';
  // Contact has no address field in this CRM yet, so this is always blank
  // when sourced from the lead's contact — not something this commit adds.
  const clientAddress = '';
  // Quote.createdById has no accompanying name in the API response (only
  // the id) — the lead's assigned agent is the closest real "asesor".
  const advisor = lead?.agent?.name || '';

  return (
    <PrintableDocumentShell>
      <DocumentHeader
        readOnly
        company={company}
        title="Cotización"
        fields={[
          { label: 'Número', value: quote.number, onChange: noop },
          { label: 'Fecha de facturación', value: formatDate(quote.createdAt), onChange: noop },
          { label: 'Válido hasta', value: quote.validUntil ? formatDate(quote.validUntil) : 'N/A', onChange: noop },
          { label: 'Asesor', value: advisor || 'N/A', onChange: noop },
        ]}
      />

      <DocumentClientInfo
        readOnly
        title="Información del cliente"
        fields={[
          { label: 'Nombre', value: clientName, onChange: noop },
          { label: 'Teléfono', value: clientPhone, onChange: noop },
          { label: 'Dirección', value: clientAddress, onChange: noop },
          { label: 'E-mail', value: clientEmail, onChange: noop },
        ]}
      />

      <DocumentItemsEditor readOnly items={items} onChange={noop} />

      <DocumentTotalsBlock
        rows={[
          { label: 'Subtotal', value: quote.subtotal },
          { label: 'Abono', value: 0 },
          { label: 'Descuento', value: quote.discount },
          { label: 'Total restante', value: quote.total, emphasize: true },
        ]}
      />

      {quote.notes && (
        <div className="mb-3">
          <div className="border border-stone-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
            Observaciones
          </div>
          <p className="w-full border border-t-0 border-stone-800 bg-[#E7D7C9] px-2 py-1 text-xs">
            {quote.notes}
          </p>
        </div>
      )}

      <DocumentTermsAndConditions terms={company.quoteFooter} />
      <DocumentSignatureBlock variant="dual" companyName={company.name} />
      <DocumentFooter company={company} />
    </PrintableDocumentShell>
  );
}
