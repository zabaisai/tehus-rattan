'use client';

import { useState } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { ProductImportSummary } from '@/types';
import {
  validateProductImportFile,
  MAX_PRODUCT_IMPORT_FILE_SIZE_MB,
  MAX_PRODUCT_IMPORT_ROWS,
} from '@/lib/products';
import { Modal } from '@/components/ui/Modal';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

const MAX_ISSUES_SHOWN = 20;

interface ProductImportModalProps {
  onClose: () => void;
  onImport: (file: File) => Promise<ProductImportSummary>;
}

export function ProductImportModal({ onClose, onImport }: ProductImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ProductImportSummary | null>(null);

  function selectFile(selected: File | null) {
    setError('');
    if (selected) {
      const validationError = validateProductImportFile(selected);
      if (validationError) {
        setFile(null);
        setError(validationError);
        return;
      }
    }
    setFile(selected);
  }

  async function handleImport() {
    if (!file) return;
    setError('');

    const validationError = validateProductImportFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setImporting(true);
    try {
      const result = await onImport(file);
      setSummary(result);
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'No se pudo importar el archivo');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal title="Importar Excel" onClose={onClose} maxWidth="md">
        {!summary && (
          <>
            <p className="mb-1 text-xs text-stone-500">
              Puedes importar un Excel aunque no todas las columnas estén completas.
              El sistema intentará adaptar nombre, categoría, precio, imagen y
              detalles al catálogo.
            </p>
            <p className="mb-4 text-xs text-stone-500">
              Puedes importar archivos Excel de hasta {MAX_PRODUCT_IMPORT_FILE_SIZE_MB}MB y
              máximo {MAX_PRODUCT_IMPORT_ROWS.toLocaleString('es-CO')} filas.
            </p>

            <label className="mb-3 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center hover:bg-stone-100">
              <Upload size={20} className="text-stone-400" />
              <span className="text-xs text-stone-500">
                {file ? (
                  <span className="flex items-center gap-1.5 font-medium text-stone-700">
                    <FileSpreadsheet size={14} />
                    {file.name}
                  </span>
                ) : (
                  'Selecciona un archivo .xlsx'
                )}
              </span>
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
              />
            </label>

            {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!file || importing}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {importing ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </>
        )}

        {summary && (
          <div>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-stone-50 px-2 py-2">
                <p className="text-lg font-semibold text-stone-900">{summary.totalRows}</p>
                <p className="text-[11px] text-stone-500">Filas detectadas</p>
              </div>
              <div className="rounded-md bg-emerald-50 px-2 py-2">
                <p className="text-lg font-semibold text-emerald-700">{summary.created}</p>
                <p className="text-[11px] text-emerald-700">Creados</p>
              </div>
              <div className="rounded-md bg-amber-50 px-2 py-2">
                <p className="text-lg font-semibold text-amber-700">{summary.skipped}</p>
                <p className="text-[11px] text-amber-700">Saltados</p>
              </div>
            </div>

            {summary.errors.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-semibold text-red-700">
                  Errores ({summary.errors.length})
                </p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-md bg-red-50 p-2 text-[11px] text-red-700">
                  {summary.errors.slice(0, MAX_ISSUES_SHOWN).map((e, i) => (
                    <li key={i}>
                      Fila {e.rowNumber}: {e.reason}
                      {e.rawName ? ` (${e.rawName})` : ''}
                    </li>
                  ))}
                  {summary.errors.length > MAX_ISSUES_SHOWN && (
                    <li>y {summary.errors.length - MAX_ISSUES_SHOWN} más...</li>
                  )}
                </ul>
              </div>
            )}

            {summary.warnings.length > 0 && (
              <div className="mb-4">
                <p className="mb-1 text-xs font-semibold text-amber-700">
                  Advertencias ({summary.warnings.length})
                </p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-md bg-amber-50 p-2 text-[11px] text-amber-700">
                  {summary.warnings.slice(0, MAX_ISSUES_SHOWN).map((w, i) => (
                    <li key={i}>
                      Fila {w.rowNumber}: {w.reason}
                      {w.rawName ? ` (${w.rawName})` : ''}
                    </li>
                  ))}
                  {summary.warnings.length > MAX_ISSUES_SHOWN && (
                    <li>y {summary.warnings.length - MAX_ISSUES_SHOWN} más...</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
