'use client';

import { DocumentHeader } from '../DocumentHeader';
import { DocumentClientInfo } from '../DocumentClientInfo';
import { DocumentItemsEditor } from '../DocumentItemsEditor';
import { DocumentTotalsBlock } from '../DocumentTotalsBlock';
import { DocumentTermsAndConditions } from '../DocumentTermsAndConditions';
import { DocumentSignatureBlock } from '../DocumentSignatureBlock';
import { DocumentFooter } from '../DocumentFooter';
import { REMISSION_PAYMENT_METHOD_SUGGESTIONS } from '@/lib/document-templates';
import {
  DocumentTransport,
  DocumentReceiver,
  DocumentItem,
  RemissionMeta,
} from '@/types/documents';

interface RemissionTemplateProps {
  meta: RemissionMeta;
  onMetaChange: (meta: RemissionMeta) => void;
  transport: DocumentTransport;
  onTransportChange: (transport: DocumentTransport) => void;
  receiver: DocumentReceiver;
  onReceiverChange: (receiver: DocumentReceiver) => void;
  items: DocumentItem[];
  onItemsChange: (items: DocumentItem[]) => void;
  iva: number;
  onIvaChange: (value: number) => void;
}

export function RemissionTemplate({
  meta,
  onMetaChange,
  transport,
  onTransportChange,
  receiver,
  onReceiverChange,
  items,
  onItemsChange,
  iva,
  onIvaChange,
}: RemissionTemplateProps) {
  const partial = items.reduce((sum, item) => sum + item.total, 0);
  const total = partial + iva;

  return (
    <div>
      <DocumentHeader
        title="Remisión"
        fields={[
          {
            label: 'Fecha de remisión',
            value: meta.remissionDate,
            type: 'date',
            onChange: (v) => onMetaChange({ ...meta, remissionDate: v }),
          },
        ]}
      />

      <DocumentClientInfo
        title="Información del transportador"
        fields={[
          {
            label: 'Nombre transportador',
            value: transport.name,
            onChange: (v) => onTransportChange({ ...transport, name: v }),
          },
          { label: 'CC/NIT', value: transport.document, onChange: (v) => onTransportChange({ ...transport, document: v }) },
          { label: 'Celular', value: transport.phone, onChange: (v) => onTransportChange({ ...transport, phone: v }) },
          { label: 'Dirección', value: transport.address, onChange: (v) => onTransportChange({ ...transport, address: v }) },
          { label: 'Placa', value: transport.plate, onChange: (v) => onTransportChange({ ...transport, plate: v }) },
        ]}
      />

      <DocumentClientInfo
        title="Quien recibe"
        fields={[
          [
            {
              label: 'Nombre cliente',
              value: receiver.name,
              onChange: (v) => onReceiverChange({ ...receiver, name: v }),
            },
            {
              label: 'Teléfono',
              value: receiver.phone,
              onChange: (v) => onReceiverChange({ ...receiver, phone: v }),
            },
          ],
        ]}
      />

      <DocumentItemsEditor items={items} onChange={onItemsChange} />

      <DocumentTotalsBlock
        rows={[
          { label: 'Valor parcial', value: partial },
          { label: 'IVA liquidado', value: iva, editable: true, onChange: onIvaChange },
          {
            label: 'Forma de pago',
            value: 0,
            hideValue: true,
            extraControl: (
              <input
                value={meta.paymentMethod}
                onChange={(e) => onMetaChange({ ...meta, paymentMethod: e.target.value })}
                list="remission-payment-method-suggestions"
                placeholder="Cuenta por cobrar / Vence"
                className="w-full bg-transparent px-2 py-1 text-xs outline-none"
              />
            ),
          },
          { label: 'Valor total', value: total, emphasize: true },
        ]}
      />
      <datalist id="remission-payment-method-suggestions">
        {REMISSION_PAYMENT_METHOD_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

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
      <DocumentSignatureBlock
        variant="single"
        receiverName={receiver.name}
        onReceiverNameChange={(v) => onReceiverChange({ ...receiver, name: v })}
      />
      <DocumentFooter />
    </div>
  );
}
