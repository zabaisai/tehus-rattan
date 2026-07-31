'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Phone, Star } from 'lucide-react';
import {
  getWhatsAppNumbers,
  renameWhatsAppNumber,
  setPrimaryWhatsAppNumber,
  type NumeroWhatsApp,
} from '@/lib/whatsapp';
import { Button } from '@/components/ui/Button';
import { ListState, mensajeDeError } from '@/components/ui/ListState';

/**
 * Los números de WhatsApp de la empresa.
 *
 * NO SE DIBUJA CON UNO SOLO. Una lista de un elemento con un botón de «hacer
 * principal» que ya lo es no informa de nada y sugiere que falta algo por
 * configurar. Aparece en cuanto hay dos, que es cuando la pregunta «¿desde
 * cuál se contesta?» existe de verdad.
 */
export function WhatsAppNumbers() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');

  const { data: numeros, isLoading, isError, error: errorCarga, refetch } =
    useQuery({
      queryKey: ['whatsapp', 'numbers'],
      queryFn: getWhatsAppNumbers,
    });

  async function refrescar() {
    await queryClient.invalidateQueries({ queryKey: ['whatsapp', 'numbers'] });
  }

  async function guardarEtiqueta(numero: NumeroWhatsApp) {
    setError(null);
    try {
      await renameWhatsAppNumber(numero.id, borrador.trim() || null);
      setEditando(null);
      await refrescar();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function hacerPrincipal(numero: NumeroWhatsApp) {
    setError(null);
    try {
      await setPrimaryWhatsAppNumber(numero.id);
      await refrescar();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  if (isLoading || isError) {
    return (
      <ListState
        isLoading={isLoading}
        isError={isError}
        isEmpty={false}
        error={errorCarga}
        onRetry={() => void refetch()}
        emptyMessage=""
      />
    );
  }

  if ((numeros?.length ?? 0) < 2) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
        <Phone size={15} />
        Números conectados
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Cada conversación se responde desde el número por el que entró. El
        principal solo se usa cuando no hay ninguno que lo diga: mensajes
        anteriores a esta función, historial importado y envíos automáticos sin
        conversación.
      </p>

      <ul className="mt-3 divide-y divide-neutral-100">
        {numeros!.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              {editando === n.id ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={borrador}
                    onChange={(e) => setBorrador(e.target.value)}
                    maxLength={40}
                    placeholder="Ventas, Soporte…"
                    aria-label={`Nombre de ${n.displayPhoneNumber ?? n.phoneNumberId}`}
                    className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
                  />
                  <Button size="sm" onClick={() => void guardarEtiqueta(n)}>
                    <Check size={13} />
                    Guardar
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setEditando(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-neutral-900">
                      {/* Sin etiqueta se enseña el número, nunca el
                          phoneNumberId: nadie reconoce 16 dígitos internos. */}
                      {n.label || n.displayPhoneNumber || 'Número sin nombre'}
                    </span>
                    {n.isPrimary && (
                      <span className="flex items-center gap-0.5 rounded bg-secondary-100 px-1.5 py-0.5 text-[10px] font-medium text-secondary-800">
                        <Star size={9} />
                        Principal
                      </span>
                    )}
                    {n.status !== 'CONNECTED' && (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700">
                        Sin conexión
                      </span>
                    )}
                  </div>
                  {n.label && n.displayPhoneNumber && (
                    <span className="text-xs text-neutral-500">
                      {n.displayPhoneNumber}
                    </span>
                  )}
                </>
              )}
            </div>

            {editando !== n.id && (
              <>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Renombrar ${n.displayPhoneNumber ?? n.phoneNumberId}`}
                  onClick={() => {
                    setEditando(n.id);
                    setBorrador(n.label ?? '');
                  }}
                >
                  <Pencil size={13} />
                </Button>
                {!n.isPrimary && (
                  <Button
                    size="sm"
                    variant="secondary"
                    // Un número sin conexión no puede enviar, así que tampoco
                    // puede ser el principal.
                    disabled={n.status !== 'CONNECTED'}
                    title={
                      n.status === 'CONNECTED'
                        ? undefined
                        : 'Desde un número sin conexión no se puede enviar'
                    }
                    onClick={() => void hacerPrincipal(n)}
                  >
                    Hacer principal
                  </Button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
