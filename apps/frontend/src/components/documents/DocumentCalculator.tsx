'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { PrintableDocumentShell } from './PrintableDocumentShell';
import { SaleInvoiceTemplate } from './templates/SaleInvoiceTemplate';
import { RepairTemplate } from './templates/RepairTemplate';
import { RemissionTemplate } from './templates/RemissionTemplate';
import { DOCUMENT_TEMPLATE_LABELS } from '@/lib/document-templates';
import {
  DocumentTemplateType,
  DocumentClient,
  DocumentTransport,
  DocumentReceiver,
  DocumentItem,
  SaleInvoiceMeta,
  RepairMeta,
  RemissionMeta,
} from '@/types/documents';

function emptyItems(): DocumentItem[] {
  return [{ id: crypto.randomUUID(), code: '', description: '', quantity: 1, unitPrice: 0, total: 0 }];
}
function emptyClient(): DocumentClient {
  return { name: '', document: '', phone: '', email: '', address: '' };
}
function emptyTransport(): DocumentTransport {
  return { name: '', document: '', phone: '', address: '', plate: '' };
}
function emptyReceiver(): DocumentReceiver {
  return { name: '', phone: '' };
}

// Purely local calculator state — nothing here reads or writes the real
// Quote/QuoteItem API yet (see the follow-up commit that connects them).
export function DocumentCalculator() {
  const [templateType, setTemplateType] = useState<DocumentTemplateType>('SALE_INVOICE');

  const [invoiceMeta, setInvoiceMeta] = useState<SaleInvoiceMeta>({
    accountNumber: '',
    billingDate: '',
    deliveryDate: '',
    advisor: '',
    observations: '',
  });
  const [invoiceClient, setInvoiceClient] = useState<DocumentClient>(emptyClient());
  const [invoiceItems, setInvoiceItems] = useState<DocumentItem[]>(emptyItems());
  const [advance, setAdvance] = useState(0);
  const [discount, setDiscount] = useState(0);

  const [repairMeta, setRepairMeta] = useState<RepairMeta>({
    accountNumber: '',
    date: '',
    advisor: '',
    observations: '',
  });
  const [repairClient, setRepairClient] = useState<DocumentClient>(emptyClient());
  const [repairItems, setRepairItems] = useState<DocumentItem[]>(emptyItems());
  const [transportCost, setTransportCost] = useState(0);
  const [others, setOthers] = useState(0);

  const [remissionMeta, setRemissionMeta] = useState<RemissionMeta>({
    remissionDate: '',
    paymentMethod: '',
    observations: '',
  });
  const [transport, setTransport] = useState<DocumentTransport>(emptyTransport());
  const [receiver, setReceiver] = useState<DocumentReceiver>(emptyReceiver());
  const [remissionItems, setRemissionItems] = useState<DocumentItem[]>(emptyItems());
  const [iva, setIva] = useState(0);

  return (
    <div>
      <div className="print-hidden mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(Object.keys(DOCUMENT_TEMPLATE_LABELS) as DocumentTemplateType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTemplateType(type)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                templateType === type
                  ? 'bg-stone-900 text-white'
                  : 'border border-stone-300 text-stone-700 hover:bg-stone-100'
              }`}
            >
              {DOCUMENT_TEMPLATE_LABELS[type]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-md bg-[#A57014] px-4 py-2 text-sm font-medium text-white hover:bg-[#8c5f10]"
        >
          <Printer size={16} />
          Imprimir / Guardar como PDF
        </button>
      </div>

      <PrintableDocumentShell>
        {templateType === 'SALE_INVOICE' && (
          <SaleInvoiceTemplate
            meta={invoiceMeta}
            onMetaChange={setInvoiceMeta}
            client={invoiceClient}
            onClientChange={setInvoiceClient}
            items={invoiceItems}
            onItemsChange={setInvoiceItems}
            advance={advance}
            onAdvanceChange={setAdvance}
            discount={discount}
            onDiscountChange={setDiscount}
          />
        )}

        {templateType === 'REPAIR' && (
          <RepairTemplate
            meta={repairMeta}
            onMetaChange={setRepairMeta}
            client={repairClient}
            onClientChange={setRepairClient}
            items={repairItems}
            onItemsChange={setRepairItems}
            transport={transportCost}
            onTransportChange={setTransportCost}
            others={others}
            onOthersChange={setOthers}
          />
        )}

        {templateType === 'REMISSION' && (
          <RemissionTemplate
            meta={remissionMeta}
            onMetaChange={setRemissionMeta}
            transport={transport}
            onTransportChange={setTransport}
            receiver={receiver}
            onReceiverChange={setReceiver}
            items={remissionItems}
            onItemsChange={setRemissionItems}
            iva={iva}
            onIvaChange={setIva}
          />
        )}
      </PrintableDocumentShell>
    </div>
  );
}
