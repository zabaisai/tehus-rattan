'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, Trash2 } from 'lucide-react';
import { getQuotes, deleteQuote, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS,
  abrirQuotePdf,
} from '@/lib/quotes';
import { QuoteStatus } from '@/types';
import { QuoteDetailModal } from '@/components/quotes/QuoteDetailModal';
import { ListState } from '@/components/ui/ListState';
import { RequireTenantCapability } from '@/components/capabilities/RequireTenantCapability';
import { useTenantCapabilities } from '@/lib/tenant-capabilities';
import { useFormatoDeDinero } from '@/lib/use-formato-de-dinero';
import { useAuthStore } from '@/store/auth.store';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

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

  // Una cotización nueva nace de los elementos del catálogo de una
  // oportunidad. Con cotizaciones activas y catálogo apagado se puede ver lo
  // que ya existe, pero no crear: se dice aquí, antes de que alguien lo busque.
  const capacidades = useTenantCapabilities();
  const { formatear: dinero } = useFormatoDeDinero();
  const rol = useAuthStore((s) => s.user?.role);
  const sinCatalogo =
    capacidades.isReady && capacidades.can('quotes') && !capacidades.can('catalog');
  const puedeConfigurar = rol === 'ADMIN' || rol === 'SUPER_ADMIN';

  const {
    data: quotes,
    isLoading,
    isError,
    error: errorCarga,
    refetch,
  } = useQuery({
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
        <h2 className="text-xl font-semibold text-neutral-900">Cotizaciones</h2>
        <p className="text-xs text-neutral-500">
          Nueva cotización desde una oportunidad: abre una oportunidad con
          elementos del catálogo y usa «Crear cotización».
        </p>
      </div>

      {sinCatalogo && (
        <p
          role="status"
          data-testid="aviso-sin-catalogo"
          className="mb-4 rounded-md border border-status-info/20 bg-status-info-surface px-3 py-2 text-xs text-status-info"
        >
          Para crear cotizaciones nuevas, la oportunidad necesita elementos del
          catálogo. El catálogo está desactivado; un administrador puede
          activarlo en{' '}
          {puedeConfigurar ? (
            <Link
              href="/dashboard/settings/company"
              className="font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              Configuración
            </Link>
          ) : (
            'Configuración'
          )}
          .
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filtrar por estado"
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
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
          // El marcador de posicion desaparece al escribir: quien usa lector
          // de pantalla se queda sin saber que campo es en cuanto empieza.
          aria-label="Filtrar por ID de oportunidad"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
        />
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-status-error">
          {error}
        </p>
      )}

      <ListState
        isLoading={isLoading}
        isError={isError}
        isEmpty={(quotes?.length ?? 0) === 0}
        error={errorCarga}
        onRetry={() => void refetch()}
        icon={FileText}
        // Con un filtro puesto, «no hay cotizaciones todavía» es falso: las
        // hay, pero ninguna encaja. Decirlo mal manda a crear una que ya
        // existe.
        emptyMessage={
          status || leadId
            ? 'Ninguna cotización coincide con el filtro.'
            : 'No hay cotizaciones todavía.'
        }
        loadingMessage="Cargando..."
      />

      {!isLoading && !isError && (quotes?.length ?? 0) > 0 && (
        <>
          {/* Móvil: tarjetas apiladas en vez de tabla */}
          <div className="flex flex-col gap-2 sm:hidden">
            {quotes?.map((quote) => (
              <div
                key={quote.id}
                onClick={() => setSelectedQuoteId(quote.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelectedQuoteId(quote.id);
                }}
                className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{quote.number}</p>
                    <p className="truncate text-xs text-neutral-500">{quote.lead.title}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${QUOTE_STATUS_COLORS[quote.status]}`}
                  >
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-neutral-900">
                    {dinero(quote.total)}
                  </p>
                  <p className="text-xs text-neutral-400">{formatDate(quote.createdAt)}</p>
                </div>
                <div className="mt-2 flex justify-end gap-1 border-t border-neutral-100 pt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void abrirQuotePdf(quote.id, quote.number);
                    }}
                    aria-label="Descargar el PDF de la cotización"
                    className="rounded p-2 text-neutral-400 hover:bg-status-warning-surface hover:text-status-warning-strong"
                  >
                    <Printer size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(quote.id);
                    }}
                    aria-label="Eliminar cotización"
                    className="rounded p-2 text-neutral-400 hover:bg-status-error-surface hover:text-status-error"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Escritorio/tablet: tabla tradicional */}
          <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white sm:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
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
                  className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50"
                >
                  <td className="px-3 py-2 font-medium text-neutral-800">{quote.number}</td>
                  <td className="px-3 py-2 text-neutral-600">{quote.lead.title}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${QUOTE_STATUS_COLORS[quote.status]}`}
                    >
                      {QUOTE_STATUS_LABELS[quote.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {dinero(quote.subtotal)}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {dinero(quote.discount)}
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-900">
                    {dinero(quote.total)}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{formatDate(quote.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void abrirQuotePdf(quote.id, quote.number);
                        }}
                        title="Ver documento imprimible"
                        className="rounded p-1.5 text-neutral-400 hover:bg-status-warning-surface hover:text-status-warning-strong"
                      >
                        <Printer size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(quote.id);
                        }}
                        title="Eliminar"
                        className="rounded p-1.5 text-neutral-400 hover:bg-status-error-surface hover:text-status-error"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
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
    <RequireTenantCapability capability="quotes">
      <Suspense fallback={<p className="py-10 text-center text-sm text-neutral-400">Cargando...</p>}>
        <QuotesPageContent />
      </Suspense>
    </RequireTenantCapability>
  );
}
