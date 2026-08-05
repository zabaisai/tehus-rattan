"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import {
  getSugerencias,
  aprobarSugerencia,
  rechazarSugerencia,
  type SugerenciaDeTarea,
} from "@/lib/sugerencias";
import { Badge } from "@/components/ui/Badge";
import { mensajeDeError } from "@/components/ui/ListState";

const PRIORIDAD: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

const ORIGEN: Record<string, string> = {
  flowbot: "Pulso",
  automation: "Automatización",
  rule: "Regla",
  agent: "Un asesor",
  system: "El sistema",
};

/**
 * Las tareas que un bot PROPONE, esperando que alguien decida.
 *
 * Se enseñan donde ya se está trabajando —la conversación, el contacto, el
 * embudo, la lista de tareas— y no en una pantalla aparte: una bandeja de
 * aprobaciones que hay que ir a visitar no se visita.
 *
 * El título es editable antes de aceptar porque lo que el bot sugiere es un
 * borrador, no una orden.
 */
export function SugerenciasDeTarea({
  contactId,
  conversationId,
  leadId,
  titulo = "Tareas propuestas",
}: {
  contactId?: string;
  conversationId?: string;
  leadId?: string;
  titulo?: string;
}) {
  const queryClient = useQueryClient();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtros = {
    estado: "PENDING" as const,
    contactId,
    conversationId,
    leadId,
  };

  const { data: sugerencias, isLoading } = useQuery({
    queryKey: ["sugerencias", filtros],
    queryFn: () => getSugerencias(filtros),
  });

  async function decidir(id: string, accion: () => Promise<unknown>) {
    setOcupada(id);
    setError(null);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: ["sugerencias"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["perfil"] });
      setEditando(null);
    } catch (e) {
      setError(mensajeDeError(e) || "No se pudo registrar la decisión.");
    } finally {
      setOcupada(null);
    }
  }

  // Sin propuestas no se pinta nada: un bloque vacío permanente es ruido.
  if (isLoading || !sugerencias?.length) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        <Sparkles size={13} className="text-brand-secondary" />
        {titulo} ({sugerencias.length})
      </h4>

      {error && (
        <p
          role="alert"
          className="mb-2 rounded-md bg-status-error-surface px-2.5 py-1.5 text-xs text-status-error"
        >
          {error}
        </p>
      )}

      <ul className="space-y-2.5">
        {sugerencias.map((s: SugerenciaDeTarea) => (
          <li key={s.id} className="rounded-md border border-neutral-200 p-2.5">
            {editando === s.id ? (
              <input
                autoFocus
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                aria-label={`Título de la tarea propuesta: ${s.title}`}
                className="mb-1.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            ) : (
              <p className="text-sm font-medium text-neutral-900">{s.title}</p>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{ORIGEN[s.source] ?? s.source}</Badge>
              <Badge tone="neutral">
                {PRIORIDAD[s.priority] ?? s.priority}
              </Badge>
              {s.suggestedUser && (
                <span className="text-[11px] text-neutral-500">
                  para {s.suggestedUser.name}
                </span>
              )}
            </div>

            {s.reason && (
              <p className="mt-1 text-xs text-neutral-600">{s.reason}</p>
            )}
            {s.excerpt && (
              <p className="mt-1 border-l-2 border-neutral-200 pl-2 text-xs italic text-neutral-500">
                {s.excerpt}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                disabled={ocupada === s.id}
                onClick={() =>
                  void decidir(s.id, () =>
                    aprobarSugerencia(
                      s.id,
                      editando === s.id && borrador.trim()
                        ? { title: borrador.trim() }
                        : {},
                    ),
                  )
                }
                className="flex items-center gap-1 rounded-md bg-brand-primary px-2.5 py-1 text-xs text-white hover:bg-primary-900 disabled:opacity-40"
              >
                {ocupada === s.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
                Aprobar
              </button>

              <button
                disabled={ocupada === s.id}
                onClick={() =>
                  void decidir(s.id, () => rechazarSugerencia(s.id))
                }
                className="flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                <X size={12} />
                Rechazar
              </button>

              {editando !== s.id && (
                <button
                  onClick={() => {
                    setEditando(s.id);
                    setBorrador(s.title);
                  }}
                  className="rounded-md px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                >
                  Editar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
