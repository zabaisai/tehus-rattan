'use client';

import { DocumentHeader } from '../DocumentHeader';
import { DocumentClientInfo } from '../DocumentClientInfo';
import { DocumentItemsEditor } from '../DocumentItemsEditor';
import { DocumentTotalsBlock } from '../DocumentTotalsBlock';
import { DocumentTermsAndConditions } from '../DocumentTermsAndConditions';
import { DocumentSignatureBlock } from '../DocumentSignatureBlock';
import { DocumentFooter } from '../DocumentFooter';
import { DocumentClient, DocumentItem, SaleInvoiceMeta } from '@/types/documents';

interface SaleInvoiceTemplateProps {
  meta: SaleInvoiceMeta;
  onMetaChange: (meta: SaleInvoiceMeta) => void;
  client: DocumentClient;
  onClientChange: (client: DocumentClient) => void;
  items: DocumentItem[];
  onItemsChange: (items: DocumentItem[]) => void;
  advance: number;
  onAdvanceChange: (value: number) => void;
  discount: number;
  onDiscountChange: (value: number) => void;
}

export function SaleInvoiceTemplate({
  meta,
  onMetaChange,
  client,
  onClientChange,
  items,
  onItemsChange,
  advance,
  onAdvanceChange,
  discount,
  onDiscountChange,
}: SaleInvoiceTemplateProps) {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const totalRemaining = Math.max(0, subtotal - advance - discount);

  return (
    <div>
      <DocumentHeader
        title="Cotización / Factura de venta"
        fields={[
          {
            label: 'Cuenta de cobro',
            value: meta.accountNumber,
            onChange: (v) => onMetaChange({ ...meta, accountNumber: v }),
          },
          {
            label: 'Fecha de facturación',
            value: meta.billingDate,
            type: 'date',
            onChange: (v) => onMetaChange({ ...meta, billingDate: v }),
          },
          {
            label: 'Fecha de entrega',
            value: meta.deliveryDate,
            type: 'date',
            onChange: (v) => onMetaChange({ ...meta, deliveryDate: v }),
          },
          {
            label: 'Asesor',
            value: meta.advisor,
            onChange: (v) => onMetaChange({ ...meta, advisor: v }),
          },
        ]}
      />

      <DocumentClientInfo
        title="Información del cliente"
        fields={[
          { label: 'Nombre', value: client.name, onChange: (v) => onClientChange({ ...client, name: v }) },
          { label: 'CC/NIT', value: client.document, onChange: (v) => onClientChange({ ...client, document: v }) },
          { label: 'Teléfono', value: client.phone, onChange: (v) => onClientChange({ ...client, phone: v }) },
          { label: 'Dirección', value: client.address, onChange: (v) => onClientChange({ ...client, address: v }) },
          { label: 'E-mail', value: client.email, onChange: (v) => onClientChange({ ...client, email: v }) },
        ]}
      />

      <DocumentItemsEditor items={items} onChange={onItemsChange} />

      <DocumentTotalsBlock
        rows={[
          { label: 'Subtotal', value: subtotal },
          { label: 'Abono', value: advance, editable: true, onChange: onAdvanceChange },
          { label: 'Descuento', value: discount, editable: true, onChange: onDiscountChange },
          { label: 'Total restante', value: totalRemaining, emphasize: true },
        ]}
      />

      <div className="mb-3">
        <div className="border border-stone-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
          Observaciones
        </div>
        <textarea
          value={meta.observations}
          onChange={(e) => onMetaChange({ ...meta, observations: e.target.value })}
          rows={2}
          className="w-full border border-t-0 border-stone-800 bg-[#E7D7C9] px-2 py-1 text-xs outline-none"
        />
      </div>

      <DocumentTermsAndConditions />
      <DocumentSignatureBlock variant="dual" />
      <DocumentFooter />
    </div>
  );
}
