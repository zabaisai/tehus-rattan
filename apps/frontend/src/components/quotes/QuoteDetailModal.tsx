'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getQuote, updateQuote, deleteQuote, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS } from '@/lib/quotes';
import { QuoteStatus } from '@/types';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function readErrorMessage(err: unknown, fallback: string) {
  const message = (err as ApiError).response?.data?.message;
  const readable = Array.isArray(message) ? message[0] : message;
  return readable || fallback;
}

interface QuoteDetailModalProps {
  quoteId: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function QuoteDetailModal({ quoteId, onClose, onChanged }: QuoteDetailModalProps) {
  const queryClient = useQueryClient();
  const queryKey = ['quote', quoteId];

  const { data: quote, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => getQuote(quoteId),
  });

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [discountDraft, setDiscountDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [validUntilDraft, setValidUntilDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: ['quotes'] });
    onChanged?.();
  }

  function startEditing() {
    if (!quote) return;
    setTitleDraft(quote.title ?? '');
    setDiscountDraft(String(quote.discount));
    setNotesDraft(quote.notes ?? '');
    setValidUntilDraft(quote.validUntil ? quote.validUntil.slice(0, 10) : '');
    setError('');
    setEditing(true);
  }

  async function handleStatusChange(status: QuoteStatus) {
    if (!quote || status === quote.status) return;
    setError('');
    setSaving(true);
    try {
      await updateQuote(quoteId, { status });
      await refresh();
    } catch (err) {
      setError(readErrorMessage(err, 'No se pudo cambiar el estado'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await updateQuote(quoteId, {
        title: titleDraft.trim() || undefined,
        discount: discountDraft ? Number(discountDraft) : undefined,
        notes: notesDraft.trim() || undefined,
        validUntil: validUntilDraft ? new Date(validUntilDraft).toISOString() : undefined,
      });
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(readErrorMessage(err, 'No se pudo guardar la cotización'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar esta cotización?')) return;
    setError('');
    setSaving(true);
    try {
      await deleteQuote(quoteId);
      await refresh();
      onClose();
    } catch (err) {
      setError(readErrorMessage(err, 'No se pudo eliminar la cotización'));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">
            {quote ? `Cotización ${quote.number}` : 'Cotización'}
          </h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>

        {isLoading && <p className="text-sm text-stone-400">Cargando...</p>}
        {isError && <p className="text-sm text-red-600">No se pudo cargar la cotización.</p>}

        {quote && !editing && (
          <div>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-medium text-stone-900">
                  {quote.title || 'Sin título'}
                </p>
                <p className="text-xs text-stone-500">Lead: {quote.lead.title}</p>
              </div>
              <select
                value={quote.status}
                onChange={(e) => handleStatusChange(e.target.value as QuoteStatus)}
                disabled={saving}
                className={`shrink-0 rounded-full border-0 px-2 py-1 text-[11px] font-medium outline-none disabled:opacity-60 ${QUOTE_STATUS_COLORS[quote.status]}`}
              >
                {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {QUOTE_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-hidden rounded-md border border-stone-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Producto</th>
                    <th className="px-2 py-1.5 font-medium">Cantidad</th>
                    <th className="px-2 py-1.5 font-medium">P. unitario</th>
                    <th className="px-2 py-1.5 font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.items ?? []).map((item) => (
                    <tr key={item.id} className="border-t border-stone-100 align-top">
                      <td className="px-2 py-1.5">
                        <p className="font-medium text-stone-800">{item.name}</p>
                        {item.category && (
                          <p className="text-[10px] text-stone-400">{item.category}</p>
                        )}
                        {item.notes && (
                          <p className="mt-0.5 text-[10px] italic text-stone-400">{item.notes}</p>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{item.quantity}</td>
                      <td className="px-2 py-1.5">{moneyFormatter.format(item.unitPrice)}</td>
                      <td className="px-2 py-1.5 font-medium text-stone-800">
                        {moneyFormatter.format(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-stone-500">Subtotal</dt>
                <dd className="text-stone-800">{moneyFormatter.format(quote.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">Descuento</dt>
                <dd className="text-stone-800">{moneyFormatter.format(quote.discount)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt className="text-stone-900">Total</dt>
                <dd className="text-stone-900">{moneyFormatter.format(quote.total)}</dd>
              </div>
            </dl>

            {(quote.notes || quote.validUntil) && (
              <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
                {quote.notes && (
                  <div>
                    <dt className="text-xs font-medium text-stone-500">Notas</dt>
                    <dd className="text-stone-800">{quote.notes}</dd>
                  </div>
                )}
                {quote.validUntil && (
                  <div>
                    <dt className="text-xs font-medium text-stone-500">Válida hasta</dt>
                    <dd className="text-stone-800">{formatDate(quote.validUntil)}</dd>
                  </div>
                )}
              </div>
            )}

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Eliminar
              </button>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Editar
              </button>
            </div>
          </div>
        )}

        {quote && editing && (
          <form onSubmit={handleSaveEdit}>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-stone-600">Título</label>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">Descuento</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discountDraft}
                  onChange={(e) => setDiscountDraft(e.target.value)}
                  className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">Válida hasta</label>
                <input
                  type="date"
                  value={validUntilDraft}
                  onChange={(e) => setValidUntilDraft(e.target.value)}
                  className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-stone-600">Notas</label>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>

            {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
                className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
