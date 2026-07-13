'use client';

import { Plus, Trash2 } from 'lucide-react';
import { DocumentItem } from '@/types/documents';

const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

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
  items: DocumentItem[];
  onChange: (items: DocumentItem[]) => void;
}

export function DocumentItemsEditor({ items, onChange }: DocumentItemsEditorProps) {
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
      <div className="border border-stone-800 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
        Información del producto
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-white">
            <th className="border border-stone-800 px-1 py-1 font-medium">Código</th>
            <th className="border border-stone-800 px-1 py-1 font-medium">Descripción</th>
            <th className="w-16 border border-stone-800 px-1 py-1 font-medium">Unidades</th>
            <th className="w-28 border border-stone-800 px-1 py-1 font-medium">Valor unitario</th>
            <th className="w-28 border border-stone-800 px-1 py-1 font-medium">Total</th>
            <th className="print-hidden w-8 border border-stone-800"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="border border-stone-800 p-0">
                <input
                  value={item.code}
                  onChange={(e) => updateItem(item.id, { code: e.target.value })}
                  className="w-full bg-transparent px-1.5 py-1 outline-none"
                />
              </td>
              <td className="border border-stone-800 p-0">
                <input
                  value={item.description}
                  onChange={(e) => updateItem(item.id, { description: e.target.value })}
                  className="w-full bg-transparent px-1.5 py-1 outline-none"
                />
              </td>
              <td className="border border-stone-800 p-0">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                  className="w-full bg-transparent px-1.5 py-1 text-right outline-none"
                />
              </td>
              <td className="border border-stone-800 p-0">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item.id, { unitPrice: Number(e.target.value) || 0 })}
                  className="w-full bg-transparent px-1.5 py-1 text-right outline-none"
                />
              </td>
              <td className="border border-stone-800 bg-[#F4EFE6] px-1.5 py-1 text-right font-medium">
                {moneyFormatter.format(item.total)}
              </td>
              <td className="print-hidden border border-stone-800 text-center">
                <button
                  type="button"
                  onClick={() => removeRow(item.id)}
                  className="p-1 text-stone-400 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addRow}
        className="print-hidden mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
      >
        <Plus size={13} />
        Agregar fila
      </button>
    </div>
  );
}
