'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { getQuote } from '@/lib/quotes';
import { getLead } from '@/lib/leads';
import { QuotePrintableDocument } from '@/components/documents/QuotePrintableDocument';

export default function QuotePrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const quoteId = params.id;

  const {
    data: quote,
    isLoading: quoteLoading,
    isError: quoteError,
  } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => getQuote(quoteId),
    // A 404/403 here means the id is wrong or belongs to another company —
    // retrying won't change that, and the default 3 retries would leave the
    // "no encontrada" message hidden behind "Cargando..." for several
    // seconds for no reason.
    retry: false,
  });

  // Best-effort: the document still renders (falling back to quote.lead.title)
  // if this fails or the lead was since removed — it's supplementary, not
  // required for the printable document to be useful.
  const { data: lead } = useQuery({
    queryKey: ['lead', quote?.leadId],
    queryFn: () => getLead(quote!.leadId),
    enabled: !!quote?.leadId,
    retry: false,
  });

  return (
    <div>
      <div className="print-hidden mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => router.push('/dashboard/quotes')}
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
        >
          <ArrowLeft size={16} />
          Volver
        </button>

        {quote && (
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-md bg-[#A57014] px-4 py-2 text-sm font-medium text-white hover:bg-[#8c5f10]"
          >
            <Printer size={16} />
            <span className="hidden sm:inline">Imprimir / Guardar como PDF</span>
            <span className="sm:hidden">Imprimir</span>
          </button>
        )}
      </div>

      {quoteLoading && <p className="text-sm text-stone-400">Cargando cotización...</p>}

      {quoteError && (
        <p className="text-sm text-red-600">
          No se pudo cargar la cotización. Puede que no exista o no pertenezca a tu empresa.
        </p>
      )}

      {quote && <QuotePrintableDocument quote={quote} lead={lead ?? null} />}
    </div>
  );
}
