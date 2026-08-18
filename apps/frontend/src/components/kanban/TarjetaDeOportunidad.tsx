"use client";

import { Draggable } from "@hello-pangea/dnd";
import { GripVertical, MessageSquare, Target } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { moneda, cuando } from "@/lib/pipeline-url";
import type { Lead } from "@/types";

/**
 * Una oportunidad del tablero (mockup 04).
 *
 * LA TARJETA NO ES UN BOTÓN GIGANTE. La anterior era un `<div role="button">`
 * con más botones dentro, que es ARIA inválido —un control no puede contener
 * controles— y obligaba a `stopPropagation` en cada hijo para que el clic no
 * hiciera dos cosas a la vez. Aquí el título ES el botón que abre la ficha, y
 * las acciones son botones de verdad al lado. Nada depende de adivinar que la
 * tarjeta entera se puede pulsar.
 *
 * EL ARRASTRE TIENE ASA PROPIA. Con la tarjeta entera como asa, empezar a
 * arrastrar desde encima de «Abrir chat» se comía la pulsación. El asa además
 * es enfocable, así que mover una oportunidad con el teclado —espacio para
 * levantarla, flechas para llevarla, espacio para soltarla— funciona sin
 * ratón. El desplegable «Mover a» hace lo mismo sin arrastrar nada, para
 * quien no puede o no quiere.
 */
export function TarjetaDeOportunidad({
  lead,
  indice,
  etapas,
  seleccionada,
  onSeleccionar,
  onAbrirOportunidad,
  onAbrirConversacion,
  onMoverDeEtapa,
}: {
  lead: Lead;
  indice: number;
  etapas: Array<{ id: string; name: string }>;
  seleccionada: boolean;
  onSeleccionar: (lead: Lead) => void;
  onAbrirOportunidad: (lead: Lead) => void;
  onAbrirConversacion: (lead: Lead) => void;
  onMoverDeEtapa: (leadId: string, etapaId: string) => void;
}) {
  const contacto = lead.contact.name || lead.contact.phone;

  return (
    <Draggable draggableId={lead.id} index={indice}>
      {(provided, snapshot) => (
        <article
          ref={provided.innerRef}
          {...provided.draggableProps}
          aria-label={`Oportunidad ${lead.title}`}
          className={`flex w-72 shrink-0 flex-col gap-2.5 rounded-lg border bg-surface-default p-3 transition-[box-shadow,border-color] duration-rapida ease-standard ${
            seleccionada
              ? "border-brand-primary shadow-md ring-2 ring-brand-primary/20"
              : "border-line-default shadow-xs hover:border-line-strong hover:shadow-sm"
          } ${snapshot.isDragging ? "shadow-lg" : ""}`}
        >
          {/* ── Identidad ─────────────────────────────────────────── */}
          <div className="flex items-start gap-2.5">
            <Avatar nombre={contacto} size="md" />

            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSeleccionar(lead)}
                // `break-words` y no `truncate`: un título largo se parte por
                // espacios y se lee entero. Cortarlo a mitad de palabra es
                // justo lo que el §8 prohíbe comprobar y encontrar.
                className="block w-full break-words text-left text-sm font-semibold text-content-primary outline-none hover:text-brand-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
              >
                {lead.title}
              </button>
              <p className="mt-0.5 break-words text-xs text-content-secondary">
                {contacto}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-content-primary">
                {moneda(lead.value)}
              </p>
            </div>

            <button
              type="button"
              {...provided.dragHandleProps}
              // El asa necesita nombre: un icono de seis puntos no dice nada
              // a quien escucha la pantalla.
              aria-label={`Mover ${lead.title} arrastrando`}
              className="-mr-1 shrink-0 rounded p-1 text-content-disabled outline-none hover:bg-surface-subtle hover:text-content-secondary focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <GripVertical size={15} aria-hidden="true" />
            </button>
          </div>

          {/* ── Responsable y última actualización ─────────────────── */}
          <div className="flex items-start justify-between gap-3 border-t border-line-default pt-2.5">
            <div className="min-w-0">
              <p className="text-[11px] text-content-secondary">Responsable</p>
              {lead.agent ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-content-primary">
                  <Avatar nombre={lead.agent.name} size="sm" />
                  <span className="min-w-0 break-words">{lead.agent.name}</span>
                </p>
              ) : (
                // Sin responsable NO es un hueco en blanco: es lo que hay que
                // resolver, y por eso se escribe.
                <p className="mt-0.5 text-xs font-medium text-status-warning-strong">
                  Sin asignar
                </p>
              )}
            </div>

            <div className="shrink-0 text-right">
              {/* «Actualizada» y no «Última actividad»: el dato es el
                  `updatedAt` de la oportunidad, no la hora del último
                  WhatsApp. Ponerle el icono de WhatsApp que dibuja el mockup
                  sería afirmar algo que este contrato no sabe. */}
              <p className="text-[11px] text-content-secondary">Actualizada</p>
              <p className="mt-0.5 font-mono text-xs tabular-nums text-content-primary">
                {cuando(lead.updatedAt)}
              </p>
            </div>
          </div>

          {/* ── Acciones ──────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onAbrirConversacion(lead)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line-default px-2 py-1.5 text-xs font-medium text-content-primary outline-none transition-colors duration-rapida ease-standard hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <MessageSquare size={13} aria-hidden="true" />
              Abrir chat
            </button>
            <button
              type="button"
              onClick={() => onAbrirOportunidad(lead)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line-default px-2 py-1.5 text-xs font-medium text-content-primary outline-none transition-colors duration-rapida ease-standard hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <Target size={13} aria-hidden="true" />
              Oportunidad
            </button>
          </div>

          {/* ── Cambio de etapa sin arrastrar ──────────────────────── */}
          <label className="flex items-center gap-2 text-[11px] text-content-secondary">
            <span className="shrink-0">Mover a</span>
            <select
              value={lead.stageId}
              aria-label={`Mover ${lead.title} a otra etapa`}
              onChange={(e) => onMoverDeEtapa(lead.id, e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line-default bg-surface-default px-1.5 py-1 text-xs text-content-primary outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              {etapas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </article>
      )}
    </Draggable>
  );
}
