'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2 } from 'lucide-react';
import { getQuotes, deleteQuote, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS } from '@/lib/quotes';
import { QuoteStatus } from '@/types';
import { QuoteDetailModal } from '@/components/quotes/QuoteDetailModal';

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

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function QuotesPageContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState('');
  const [leadId, setLeadId] = useState('');
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(
    searchParams.get('open'),
  );
  const [error, setError] = useState('');

  const { data: quotes, isLoading } = useQuery({
    queryKey: ['quotes', status, leadId],
    queryFn: () =>
      getQuotes({
        status: status || undefined,
        leadId: leadId || undefined,
      }),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['quotes'] });
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta cotización?')) return;
    setError('');
    try {
      await deleteQuote(id);
      await refresh();
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const readable = Array.isArray(message) ? message[0] : message;
      setError(readable || 'No se pudo eliminar la cotización');
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-stone-900">Cotizaciones</h2>
        <p className="text-xs text-stone-500">
          Nueva cotización desde lead: abre un lead con productos asociados y usa
          &quot;Crear cotización&quot;.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        >
          <option value="">Todos los estados</option>
          {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((s) => (
            <option key={s} value={s}>
              {QUOTE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
          placeholder="Filtrar por ID de lead"
          className="rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
        />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {isLoading && <p className="py-10 text-center text-sm text-stone-400">Cargando...</p>}

      {!isLoading && (quotes?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white py-14 text-stone-400">
          <FileText size={28} strokeWidth={1.5} />
          <p className="text-sm">No hay cotizaciones todavía.</p>
        </div>
      )}

      {!isLoading && (quotes?.length ?? 0) > 0 && (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Número</th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Subtotal</th>
                <th className="px-3 py-2 font-medium">Descuento</th>
                <th className="px-3 py-2 font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {quotes?.map((quote) => (
                <tr
                  key={quote.id}
                  onClick={() => setSelectedQuoteId(quote.id)}
                  className="cursor-pointer border-t border-stone-100 hover:bg-stone-50"
                >
                  <td className="px-3 py-2 font-medium text-stone-800">{quote.number}</td>
                  <td className="px-3 py-2 text-stone-600">{quote.lead.title}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${QUOTE_STATUS_COLORS[quote.status]}`}
                    >
                      {QUOTE_STATUS_LABELS[quote.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-stone-600">
                    {moneyFormatter.format(quote.subtotal)}
                  </td>
                  <td className="px-3 py-2 text-stone-600">
                    {moneyFormatter.format(quote.discount)}
                  </td>
                  <td className="px-3 py-2 font-medium text-stone-900">
                    {moneyFormatter.format(quote.total)}
                  </td>
                  <td className="px-3 py-2 text-stone-500">{formatDate(quote.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(quote.id);
                      }}
                      className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedQuoteId && (
        <QuoteDetailModal
          quoteId={selectedQuoteId}
          onClose={() => setSelectedQuoteId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

export default function QuotesPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-stone-400">Cargando...</p>}>
      <QuotesPageContent />
    </Suspense>
  );
}
