'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { getWhatsAppIntegration } from '@/lib/whatsapp';
import { WhatsAppIntegrationForm } from './WhatsAppIntegrationForm';

// Legacy manual connection — SUPER_ADMIN only, hidden behind an "advanced"
// disclosure with a security warning. The access token is never prefilled or
// returned; the form always starts with an empty token field.
export function ManualConnectionSection({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: integration } = useQuery({
    queryKey: ['whatsapp-integration'],
    queryFn: getWhatsAppIntegration,
    enabled: open,
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-neutral-700"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-neutral-400" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-neutral-400" aria-hidden />
        )}
        Conexión manual (avanzada)
        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
          Solo super administrador
        </span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 py-4">
          <div className="mb-4 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Método heredado. Requiere pegar manualmente el Phone Number ID, el
              Access Token y el WABA ID de Meta. Prefiere “Conectar con Meta”
              siempre que sea posible. El token nunca se muestra ni se
              almacena en el navegador.
            </span>
          </div>
          <WhatsAppIntegrationForm
            integration={integration ?? null}
            onSuccess={onChanged}
          />
        </div>
      )}
    </div>
  );
}
