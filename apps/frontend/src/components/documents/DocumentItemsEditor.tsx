'use client';

import { Plus, Trash2 } from 'lucide-react';
import { DocumentItem } from '@/types/documents';
import { formatearDinero, type RegionDeMoneda } from '@/lib/dinero';

function emptyItem(): DocumentItem {
  return {
    id: crypto.randomUUID(),
    code: '',
    description: '',
    quantity: 1,
    unitPrice: 0,
    total: 0,
  };
}

interface DocumentItemsEditorProps {
  /** Moneda e idioma de la empresa; llega por propiedad, no se consulta aquí. */
  region?: RegionDeMoneda;
  items: DocumentItem[];
  onChange: (items: DocumentItem[]) => void;
  // Used by QuotePrintableDocument: a real quote's items are a snapshot,
  // never edited from the print view — no add/remove row, no editable
  // cells, just the values as they were when the quote was created.
  readOnly?: boolean;
}

export function DocumentItemsEditor({
  items,
  onChange,
  readOnly,
  region,
}: DocumentItemsEditorProps) {
  function updateItem(id: string, patch: Partial<DocumentItem>) {
    onChange(
      items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        next.total = next.quantity * next.unitPrice;
        return next;
      }),
    );
  }

  function addRow() {
    onChange([...items, emptyItem()]);
  }

  function removeRow(id: string) {
    onChange(items.filter((item) => item.id !== id));
  }

  return (
    <div className="mb-3">
      <div className="border border-neutral-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
        Información del producto
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-white">
            <th className="border border-neutral-800 px-1 py-1 font-medium">Código</th>
            <th className="border border-neutral-800 px-1 py-1 font-medium">Descripción</th>
            <th className="w-16 border border-neutral-800 px-1 py-1 font-medium">Unidades</th>
            <th className="w-28 border border-neutral-800 px-1 py-1 font-medium">Valor unitario</th>
            <th className="w-28 border border-neutral-800 px-1 py-1 font-medium">Total</th>
            {!readOnly && <th className="print-hidden w-8 border border-neutral-800"></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id}>
              <td className="border border-neutral-800 p-0">
                {readOnly ? (
                  <span className="block px-1.5 py-1">{item.code}</span>
                ) : (
                  <input
                    value={item.code}
                    aria-label={`Código de la fila ${index + 1}`}
                    onChange={(e) => updateItem(item.id, { code: e.target.value })}
                    className="w-full bg-transparent px-1.5 py-1 outline-none"
                  />
                )}
              </td>
              <td className="border border-neutral-800 p-0">
                {readOnly ? (
                  <span className="block px-1.5 py-1">{item.description}</span>
                ) : (
                  <input
                    value={item.description}
                    aria-label={`Descripción de la fila ${index + 1}`}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    className="w-full bg-transparent px-1.5 py-1 outline-none"
                  />
                )}
              </td>
              <td className="border border-neutral-800 p-0">
                {readOnly ? (
                  <span className="block px-1.5 py-1 text-right">{item.quantity}</span>
                ) : (
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={item.quantity}
                    aria-label={`Unidades de la fila ${index + 1}`}
                    onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                    className="w-full bg-transparent px-1.5 py-1 text-right outline-none"
                  />
                )}
              </td>
              <td className="border border-neutral-800 p-0">
                {readOnly ? (
                  <span className="block px-1.5 py-1 text-right">
                    {formatearDinero(item.unitPrice, region)}
                  </span>
                ) : (
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.unitPrice}
                    aria-label={`Valor unitario de la fila ${index + 1}`}
                    onChange={(e) => updateItem(item.id, { unitPrice: Number(e.target.value) || 0 })}
                    className="w-full bg-transparent px-1.5 py-1 text-right outline-none"
                  />
                )}
              </td>
              <td className="border border-neutral-800 bg-[#F4EFE6] px-1.5 py-1 text-right font-medium">
                {formatearDinero(item.total, region)}
              </td>
              {!readOnly && (
                <td className="print-hidden border border-neutral-800 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(item.id)}
                    aria-label={`Quitar fila ${index + 1}`}
                    className="rounded p-1 text-neutral-400 outline-none hover:text-status-error focus-visible:ring-2 focus-visible:ring-line-focus"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          onClick={addRow}
          className="print-hidden mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-status-warning-strong hover:bg-status-warning-surface"
        >
          <Plus size={13} />
          Agregar fila
        </button>
      )}
    </div>
  );
}
