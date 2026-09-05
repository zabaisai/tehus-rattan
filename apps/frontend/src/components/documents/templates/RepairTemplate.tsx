'use client';

import { DocumentHeader } from '../DocumentHeader';
import { DocumentClientInfo } from '../DocumentClientInfo';
import { DocumentItemsEditor } from '../DocumentItemsEditor';
import { DocumentTotalsBlock } from '../DocumentTotalsBlock';
import { DocumentSignatureBlock } from '../DocumentSignatureBlock';
import { DocumentFooter } from '../DocumentFooter';
import { type RegionDeMoneda } from '@/lib/dinero';
import {
  DocumentClient,
  DocumentCompanyIdentity,
  DocumentItem,
  RepairMeta,
} from '@/types/documents';

interface RepairTemplateProps {
  /** Moneda e idioma de la empresa; se reenvía a los bloques de importes. */
  region?: RegionDeMoneda;

  company: DocumentCompanyIdentity;
  meta: RepairMeta;
  onMetaChange: (meta: RepairMeta) => void;
  client: DocumentClient;
  onClientChange: (client: DocumentClient) => void;
  items: DocumentItem[];
  onItemsChange: (items: DocumentItem[]) => void;
  transport: number;
  onTransportChange: (value: number) => void;
  others: number;
  onOthersChange: (value: number) => void;
}

// No DocumentTermsAndConditions here on purpose — the "Reparacion" sheet in
// the reference Excel has no T&C block at all (confirmed by direct
// inspection), unlike "Factura venta" and "Remision".
export function RepairTemplate({
  region,
  company,
  meta,
  onMetaChange,
  client,
  onClientChange,
  items,
  onItemsChange,
  transport,
  onTransportChange,
  others,
  onOthersChange,
}: RepairTemplateProps) {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const totalRemaining = Math.max(0, subtotal + transport + others);

  return (
    <div>
      <DocumentHeader
        company={company}
        title="Reparación"
        fields={[
          {
            label: 'Cuenta de cobro N°',
            value: meta.accountNumber,
            onChange: (v) => onMetaChange({ ...meta, accountNumber: v }),
          },
          {
            label: 'Fecha de entrega',
            value: meta.date,
            type: 'date',
            onChange: (v) => onMetaChange({ ...meta, date: v }),
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
          { label: 'Cel.', value: client.phone, onChange: (v) => onClientChange({ ...client, phone: v }) },
          { label: 'Dirección', value: client.address, onChange: (v) => onClientChange({ ...client, address: v }) },
          { label: 'E-mail', value: client.email, onChange: (v) => onClientChange({ ...client, email: v }) },
        ]}
      />

      <DocumentItemsEditor region={region} items={items} onChange={onItemsChange} />

      <DocumentTotalsBlock
        region={region}
        rows={[
          { label: 'Subtotal', value: subtotal },
          { label: 'Transporte', value: transport, editable: true, onChange: onTransportChange },
          { label: 'Otros', value: others, editable: true, onChange: onOthersChange },
          { label: 'Total restante', value: totalRemaining, emphasize: true },
        ]}
      />

      <div className="mb-3">
        <div className="border border-neutral-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
          Observaciones de reparación
        </div>
        <textarea
          aria-label="Observaciones de reparación"
          value={meta.observations}
          onChange={(e) => onMetaChange({ ...meta, observations: e.target.value })}
          rows={3}
          className="w-full border border-t-0 border-neutral-800 bg-[#E7D7C9] px-2 py-1 text-xs outline-none"
        />
      </div>

      <DocumentSignatureBlock variant="dual" companyName={company.name} />
      <DocumentFooter company={company} />
    </div>
  );
}
