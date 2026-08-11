'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { getQuote, updateQuote, deleteQuote, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS } from '@/lib/quotes';
import DesgloseEconomico from './DesgloseEconomico';
import { QuoteStatus } from '@/types';
import { Modal } from '@/components/ui/Modal';

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
  const [shippingDraft, setShippingDraft] = useState('');
  const [adjustmentDraft, setAdjustmentDraft] = useState('');
  const [adjustmentLabelDraft, setAdjustmentLabelDraft] = useState('');
  const [taxRateDraft, setTaxRateDraft] = useState('');
  const [taxIncludedDraft, setTaxIncludedDraft] = useState(false);
  const [lineDiscounts, setLineDiscounts] = useState<Record<string, string>>({});
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
    setShippingDraft(String(quote.shipping));
    setAdjustmentDraft(String(quote.adjustment));
    setAdjustmentLabelDraft(quote.adjustmentLabel ?? '');
    setTaxRateDraft(String(quote.taxRate));
    setTaxIncludedDraft(quote.taxIncluded);
    setLineDiscounts(
      Object.fromEntries(
        (quote.items ?? []).map((i) => [i.id, String(i.lineDiscount)]),
      ),
    );
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
      // Solo se envían las líneas cuyo descuento CAMBIÓ. Mandarlas todas
      // haría que abrir y guardar sin tocar nada reescribiera cada línea.
      const lineas = (quote?.items ?? [])
        .filter((i) => Number(lineDiscounts[i.id] ?? 0) !== i.lineDiscount)
        .map((i) => ({ id: i.id, lineDiscount: Number(lineDiscounts[i.id] || 0) }));

      await updateQuote(quoteId, {
        title: titleDraft.trim() || undefined,
        discount: discountDraft ? Number(discountDraft) : undefined,
        shipping: shippingDraft ? Number(shippingDraft) : undefined,
        adjustment: adjustmentDraft ? Number(adjustmentDraft) : undefined,
        adjustmentLabel: adjustmentLabelDraft.trim() || undefined,
        taxRate: taxRateDraft ? Number(taxRateDraft) : undefined,
        taxIncluded: taxIncludedDraft,
        ...(lineas.length > 0 ? { lineas } : {}),
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
    <Modal
      title={quote ? `Cotización ${quote.number}` : 'Cotización'}
      onClose={onClose}
      maxWidth="2xl"
    >
        {isLoading && <p className="text-sm text-neutral-400">Cargando...</p>}
        {isError && <p className="text-sm text-status-error">No se pudo cargar la cotización.</p>}

        {quote && !editing && (
          <div>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-medium text-neutral-900">
                  {quote.title || 'Sin título'}
                </p>
                <p className="text-xs text-neutral-500">Lead: {quote.lead.title}</p>
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

            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Producto</th>
                    <th className="px-2 py-1.5 font-medium">Cantidad</th>
                    <th className="px-2 py-1.5 font-medium">P. unitario</th>
                    <th className="px-2 py-1.5 font-medium">Dcto. línea</th>
                    <th className="px-2 py-1.5 font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.items ?? []).map((item) => (
                    <tr key={item.id} className="border-t border-neutral-100 align-top">
                      <td className="px-2 py-1.5">
                        <p className="font-medium text-neutral-800">{item.name}</p>
                        {item.category && (
                          <p className="text-[10px] text-neutral-400">{item.category}</p>
                        )}
                        {item.notes && (
                          <p className="mt-0.5 text-[10px] italic text-neutral-400">{item.notes}</p>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{item.quantity}</td>
                      <td className="px-2 py-1.5">{moneyFormatter.format(item.unitPrice)}</td>
                      <td className="px-2 py-1.5 text-neutral-500">
                        {item.lineDiscount > 0 ? `−${moneyFormatter.format(item.lineDiscount)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 font-medium text-neutral-800">
                        {moneyFormatter.format(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DesgloseEconomico quote={quote} formatter={moneyFormatter} />

            {(quote.notes || quote.validUntil) && (
              <div className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3 text-sm">
                {quote.notes && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Notas</dt>
                    <dd className="text-neutral-800">{quote.notes}</dd>
                  </div>
                )}
                {quote.validUntil && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Válida hasta</dt>
                    <dd className="text-neutral-800">{formatDate(quote.validUntil)}</dd>
                  </div>
                )}
              </div>
            )}

            {error && <p className="mt-3 text-xs text-status-error">{error}</p>}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md border border-status-error/20 px-3 py-1.5 text-sm text-status-error hover:bg-status-error-surface disabled:opacity-50"
              >
                Eliminar
              </button>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => window.open(`/dashboard/quotes/${quoteId}/print`, '_blank')}
                className="flex items-center gap-1.5 rounded-md bg-[#A57014] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#8c5f10]"
              >
                <Printer size={14} />
                Ver documento imprimible
              </button>
            </div>
          </div>
        )}

        {quote && editing && (
          <form onSubmit={handleSaveEdit}>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-neutral-600">Título</label>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">Descuento</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discountDraft}
                  onChange={(e) => setDiscountDraft(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">Válida hasta</label>
                <input
                  type="date"
                  value={validUntilDraft}
                  onChange={(e) => setValidUntilDraft(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
              </div>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="cot-transporte" className="mb-1 block text-xs font-medium text-neutral-600">
                  Transporte
                </label>
                <input
                  id="cot-transporte"
                  type="number"
                  min="0"
                  step="0.01"
                  value={shippingDraft}
                  onChange={(e) => setShippingDraft(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
              </div>
              <div>
                <label htmlFor="cot-iva" className="mb-1 block text-xs font-medium text-neutral-600">
                  IVA (%)
                </label>
                <input
                  id="cot-iva"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRateDraft}
                  onChange={(e) => setTaxRateDraft(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
              </div>
              <div>
                <label htmlFor="cot-ajuste" className="mb-1 block text-xs font-medium text-neutral-600">
                  Ajuste
                </label>
                <input
                  id="cot-ajuste"
                  type="number"
                  step="0.01"
                  value={adjustmentDraft}
                  onChange={(e) => setAdjustmentDraft(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
                <p className="mt-1 text-[10px] text-neutral-400">
                  Puede ser negativo para rebajar el total.
                </p>
              </div>
              <div>
                <label htmlFor="cot-ajuste-etiqueta" className="mb-1 block text-xs font-medium text-neutral-600">
                  Concepto del ajuste
                </label>
                <input
                  id="cot-ajuste-etiqueta"
                  type="text"
                  maxLength={80}
                  value={adjustmentLabelDraft}
                  onChange={(e) => setAdjustmentLabelDraft(e.target.value)}
                  placeholder="Ej. Rebaja acordada"
                  className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                />
              </div>
            </div>

            <label className="mb-3 flex items-center gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={taxIncludedDraft}
                onChange={(e) => setTaxIncludedDraft(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300"
              />
              El precio unitario ya incluye el IVA
            </label>

            {(quote.items ?? []).length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-xs font-medium text-neutral-600">Descuento por línea</p>
                <div className="space-y-2">
                  {(quote.items ?? []).map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <label htmlFor={`dcto-${item.id}`} className="flex-1 truncate text-xs text-neutral-500">
                        {item.name}
                      </label>
                      <input
                        id={`dcto-${item.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={lineDiscounts[item.id] ?? ''}
                        onChange={(e) =>
                          setLineDiscounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        className="w-32 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-neutral-600">Notas</label>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            </div>

            {error && <p className="mb-3 text-xs text-status-error">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white hover:bg-primary-900 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
    </Modal>
  );
}
