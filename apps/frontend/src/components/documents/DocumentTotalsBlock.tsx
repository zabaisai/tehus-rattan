'use client';

import { formatearDinero, type RegionDeMoneda } from '@/lib/dinero';

export interface DocumentTotalsRow {
  label: string;
  value: number;
  editable?: boolean;
  onChange?: (value: number) => void;
  emphasize?: boolean;
  extraControl?: React.ReactNode;
  // For rows like "Forma de pago" that are a free-text control, not a
  // currency amount — extraControl fills the row instead of a value cell.
  hideValue?: boolean;
}

interface DocumentTotalsBlockProps {
  /**
   * Moneda e idioma de la empresa. Llega por propiedad porque este bloque es
   * puramente visual y se reutiliza en la cotización imprimible y en la
   * calculadora de documentos.
   */
  region?: RegionDeMoneda;
  rows: DocumentTotalsRow[];
}

// All three templates' totals sections share the same visual: a beige-
// filled label/value table (matches the SUBTOTAL/ABONO/DESCUENTO/TOTAL
// RESTANTE rows in the Excel), just with a different set of rows per type.
export function DocumentTotalsBlock({
  rows,
  region,
}: DocumentTotalsBlockProps) {
  return (
    <table className="mb-3 ml-auto w-64 border-collapse text-xs">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td
              className={`border border-neutral-800 bg-[#E7D7C9] px-2 py-1 font-medium ${
                row.emphasize ? 'text-sm font-bold' : ''
              }`}
            >
              {row.label}
            </td>
            {row.extraControl && (
              <td className="border border-neutral-800 bg-[#E7D7C9] p-0">{row.extraControl}</td>
            )}
            {!row.hideValue && (
              <td
                className={`border border-neutral-800 bg-[#E7D7C9] px-2 py-1 text-right ${
                  row.emphasize ? 'text-sm font-bold' : ''
                }`}
              >
                {row.editable ? (
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.value}
                    aria-label={row.label}
                    onChange={(e) => row.onChange?.(Number(e.target.value) || 0)}
                    className="w-full bg-transparent text-right outline-none"
                  />
                ) : (
                  formatearDinero(row.value, region)
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
