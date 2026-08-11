'use client';

import { useState } from 'react';
import { Target, ListPlus, Check } from 'lucide-react';
import { createTask } from '@/lib/tasks';
import type { Conversation } from '@/types';

/**
 * Cabecera comercial del chat: en qué punto del embudo está este cliente y un
 * atajo para dejar una tarea sin salir de la conversación.
 *
 * Existe porque el asesor decide el siguiente paso MIENTRAS lee el mensaje.
 * Obligarle a abrir el tablero, buscar la ficha y volver es exactamente el
 * momento en que el seguimiento se pierde.
 */
export function ConversationOpportunity({
  conversation,
  onTaskCreated,
}: {
  conversation: Conversation;
  onTaskCreated?: () => void | Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [creada, setCreada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lead = conversation.lead;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = titulo.trim();
    if (!limpio || guardando) return;

    setGuardando(true);
    setError(null);
    try {
      await createTask({
        title: limpio,
        type: 'FOLLOW_UP',
        conversationId: conversation.id,
        // Se ata también a la oportunidad y al contacto cuando existen: así la
        // tarea aparece igual desde el tablero y desde la ficha del cliente,
        // que es donde se la busca después.
        ...(lead ? { leadId: lead.id } : {}),
        ...(conversation.contact?.id ? { contactId: conversation.contact.id } : {}),
      });
      setTitulo('');
      setAbierto(false);
      setCreada(true);
      setTimeout(() => setCreada(false), 2500);
      await onTaskCreated?.();
    } catch {
      setError('No se pudo crear la tarea. Inténtalo de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="border-b border-neutral-200 bg-neutral-50/70 px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {lead ? (
          <div className="flex min-w-0 items-center gap-2">
            <Target size={14} className="shrink-0 text-neutral-400" />
            <span className="truncate text-xs font-medium text-neutral-700">
              {lead.title}
            </span>
            {lead.stage && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${lead.stage.color ?? '#78716c'}20`,
                  color: lead.stage.color ?? '#57534e',
                }}
              >
                {lead.stage.name}
              </span>
            )}
          </div>
        ) : (
          // No toda conversación es una venta (soporte, consultas, spam), así
          // que "sin oportunidad" se muestra como un estado normal, no como
          // un error ni como algo que haya que corregir.
          <span className="text-xs text-neutral-400">Sin oportunidad asociada</span>
        )}

        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200/70"
        >
          {creada ? (
            <>
              <Check size={13} className="text-status-success-strong" />
              Tarea creada
            </>
          ) : (
            <>
              <ListPlus size={13} />
              Nueva tarea
            </>
          )}
        </button>
      </div>

      {abierto && (
        <form onSubmit={guardar} className="mt-2 flex flex-wrap gap-2">
          <input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="¿Qué hay que hacer?"
            aria-label="Título de la tarea"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={!titulo.trim() || guardando}
            className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-900 disabled:opacity-40"
          >
            {guardando ? 'Guardando…' : 'Crear'}
          </button>
        </form>
      )}

      {error && <p className="mt-1.5 text-xs text-status-error">{error}</p>}
    </div>
  );
}
