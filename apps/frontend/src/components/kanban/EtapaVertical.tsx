"use client";

import { useId, useState } from "react";
import { Droppable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight, LogIn, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectorDeColor } from "@/components/ui/SelectorDeColor";
import { TarjetaDeOportunidad } from "./TarjetaDeOportunidad";
import { moneda } from "@/lib/pipeline-url";
import type { KanbanStage, Lead, PipelineStage } from "@/types";

const GRIS_DE_ETAPA_SIN_COLOR = "#9AA1B2";

/**
 * Una etapa del embudo, apilada (mockup 04).
 *
 * ES LA DIFERENCIA CON EL TABLERO ANTERIOR. El kanban horizontal ponía las
 * etapas en columnas: con cinco etapas y una pantalla de 1024 px, las dos
 * últimas quedaban fuera y la página entera se desplazaba de lado. Apiladas,
 * cada etapa ocupa el ancho completo, el recorrido comercial se lee de arriba
 * abajo —que es como se cuenta— y lo único que se desplaza en horizontal es la
 * fila de tarjetas de la etapa, dentro de su propia caja.
 *
 * PLEGAR NO ES DECORACIÓN. Un embudo con nueve etapas no cabe en una pantalla;
 * poder cerrar las que hoy no se tocan es lo que hace utilizable el tablero. El
 * estado de plegado viaja en la URL, así que volver del chat devuelve el
 * tablero como se dejó.
 */
export function EtapaVertical({
  etapa,
  configuracion,
  indice,
  etapas,
  plegada,
  seleccion,
  hayFiltro,
  puedeAdministrar,
  onPlegar,
  onAgregar,
  onSeleccionar,
  onAbrirOportunidad,
  onAbrirConversacion,
  onMoverDeEtapa,
  onGuardarEtapa,
}: {
  etapa: KanbanStage;
  /** La etapa tal y como la define el embudo: probabilidad y etapa de entrada. */
  configuracion: PipelineStage | undefined;
  indice: number;
  etapas: Array<{ id: string; name: string }>;
  plegada: boolean;
  seleccion: string | null;
  hayFiltro: boolean;
  puedeAdministrar: boolean;
  onPlegar: (etapaId: string, plegada: boolean) => void;
  onAgregar: (etapaId: string) => void;
  onSeleccionar: (lead: Lead) => void;
  onAbrirOportunidad: (lead: Lead) => void;
  onAbrirConversacion: (lead: Lead) => void;
  onMoverDeEtapa: (leadId: string, etapaId: string) => void;
  onGuardarEtapa: (
    etapaId: string,
    cambios: { name?: string; color?: string | null; isInitial?: boolean },
  ) => Promise<boolean>;
}) {
  const idPanel = useId();
  const [editando, setEditando] = useState(false);

  const color = etapa.color || GRIS_DE_ETAPA_SIN_COLOR;
  const esEntrada = configuracion?.isInitial ?? false;
  const probabilidad = configuracion?.probability;

  return (
    <section
      aria-label={`Etapa ${etapa.name}`}
      className="overflow-hidden rounded-lg border border-line-default bg-surface-default"
    >
      {/* ── Cabecera ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-subtle px-3 py-2.5">
        <button
          type="button"
          onClick={() => onPlegar(etapa.id, !plegada)}
          // El nombre dice QUÉ HACE, no solo dónde está: «Nuevo» a secas,
          // dentro de una cabecera que también lleva «Agregar» y «Editar», no
          // deja claro que pulsarla pliega la etapa.
          aria-label={`${plegada ? "Desplegar" : "Plegar"} la etapa ${etapa.name}`}
          aria-expanded={!plegada}
          aria-controls={idPanel}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
        >
          {plegada ? (
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-content-secondary" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-content-secondary" />
          )}

          {/* El número de orden, como en el mockup. Decorativo: el nombre de
              la etapa ya identifica la fila. */}
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-sm font-semibold tabular-nums text-content-disabled"
          >
            {String(indice + 1).padStart(2, "0")}
          </span>

          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              style={{ backgroundColor: color }}
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
            />
            <span className="min-w-0 break-words text-sm font-semibold text-content-primary">
              {etapa.name}
            </span>
          </span>

          {esEntrada && (
            <Badge tone="success" className="shrink-0">
              <LogIn size={10} aria-hidden="true" />
              Entrada
            </Badge>
          )}
        </button>

        {/* Las cifras de la etapa. Salen de las MISMAS tarjetas que hay
            debajo, filtro incluido: si el buscador deja tres, la cabecera
            dice tres. */}
        <dl className="flex shrink-0 items-center gap-x-3 gap-y-1 text-xs text-content-secondary">
          <div className="flex items-center gap-1">
            <dd className="font-mono font-semibold tabular-nums text-content-primary">
              {etapa.leads.length}
            </dd>
            <dt>{etapa.leads.length === 1 ? "oportunidad" : "oportunidades"}</dt>
          </div>
          <div className="flex items-center gap-1">
            <dt className="sr-only">Valor de la etapa</dt>
            <dd className="font-mono font-semibold tabular-nums text-content-primary">
              {moneda(etapa.totalValue)}
            </dd>
          </div>
          {typeof probabilidad === "number" && (
            <div className="flex items-center gap-1">
              <dd className="font-mono tabular-nums">{probabilidad}%</dd>
              {/* «de cierre» y no «conversión»: el dato es la probabilidad
                  configurada en la etapa, no una conversión medida. */}
              <dt>de cierre</dt>
            </div>
          )}
        </dl>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => onAgregar(etapa.id)}
            aria-label={`Agregar oportunidad en ${etapa.name}`}
          >
            <Plus size={14} aria-hidden="true" />
            Agregar
          </Button>

          {puedeAdministrar && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setEditando((v) => !v)}
              aria-expanded={editando}
              aria-label={`Editar la etapa ${etapa.name}`}
            >
              <Pencil size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {editando && puedeAdministrar && (
        <EditorDeEtapa
          etapa={etapa}
          esEntrada={esEntrada}
          onCerrar={() => setEditando(false)}
          onGuardar={onGuardarEtapa}
        />
      )}

      {/* ── Tarjetas ──────────────────────────────────────────────── */}
      {/* Plegada NO se dibuja con `hidden`. Un `Droppable` registrado pero en
          `display:none` no se puede medir: la biblioteca de arrastre avisa por
          consola y el criterio de cierre de este incremento es que la consola
          quede limpia. Sin montar, sencillamente no es un destino de
          arrastre —que es lo que cabe esperar de una etapa cerrada— y el
          desplegable «Mover a» sigue llevando tarjetas hasta ella. */}
      <div id={idPanel}>
        {!plegada && (
        <Droppable droppableId={etapa.id} direction="horizontal">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              // LA ÚNICA CAJA QUE SE DESPLAZA DE LADO EN TODA LA PANTALLA.
              // `min-w-0` en los ancestros y este `overflow-x-auto` aquí son
              // lo que impide que el documento entero saque una segunda barra
              // horizontal cuando una etapa tiene doce oportunidades.
              className={`flex gap-3 overflow-x-auto overflow-y-hidden p-3 transition-colors duration-rapida ease-standard ${
                snapshot.isDraggingOver ? "bg-primary-50" : ""
              }`}
            >
              {etapa.leads.map((lead, i) => (
                <TarjetaDeOportunidad
                  key={lead.id}
                  lead={lead}
                  indice={i}
                  etapas={etapas}
                  seleccionada={seleccion === lead.id}
                  onSeleccionar={onSeleccionar}
                  onAbrirOportunidad={onAbrirOportunidad}
                  onAbrirConversacion={onAbrirConversacion}
                  onMoverDeEtapa={onMoverDeEtapa}
                />
              ))}

              {etapa.leads.length === 0 && (
                // El vacío DICE QUÉ HACER, y distingue «no hay nada» de «el
                // filtro no deja ver nada»: la respuesta correcta a cada uno
                // es distinta.
                <p className="w-full py-4 text-center text-xs text-content-secondary">
                  {hayFiltro ? (
                    "Ninguna oportunidad de esta etapa coincide con el filtro."
                  ) : (
                    <>
                      Sin oportunidades en esta etapa.{" "}
                      <button
                        type="button"
                        onClick={() => onAgregar(etapa.id)}
                        className="font-medium text-brand-primary underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                      >
                        Agregar la primera
                      </button>
                      .
                    </>
                  )}
                </p>
              )}

              {provided.placeholder}
            </div>
          )}
        </Droppable>
        )}
      </div>
    </section>
  );
}

/**
 * Editar la etapa sin salir del tablero.
 *
 * El mockup lo dibuja como una ventana flotante; aquí se despliega bajo la
 * cabecera. Una ventana flotante anclada a una fila que además se desplaza
 * dentro de una zona con `overflow` es la receta conocida de que el panel se
 * recorte o empuje el documento, y esta pantalla tiene como criterio de cierre
 * no sacar una segunda barra de desplazamiento.
 *
 * NO LLEVA «ARCHIVAR ETAPA». El mockup la ofrece aquí, pero en el producto esa
 * acción es un borrado definitivo (`DELETE /pipelines/:id/stages/:stageId`),
 * no un archivado reversible. La lección de 3.z fue exactamente esta: un
 * borrado irreversible no puede ser algo que se descubra pulsando. Sigue
 * disponible, con sus avisos, en la administración de embudos.
 */
function EditorDeEtapa({
  etapa,
  esEntrada,
  onCerrar,
  onGuardar,
}: {
  etapa: KanbanStage;
  esEntrada: boolean;
  onCerrar: () => void;
  onGuardar: (
    etapaId: string,
    cambios: { name?: string; color?: string | null; isInitial?: boolean },
  ) => Promise<boolean>;
}) {
  const idNombre = useId();
  const [nombre, setNombre] = useState(etapa.name);
  const [color, setColor] = useState<string | null>(etapa.color);
  const [inicial, setInicial] = useState(esEntrada);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const ok = await onGuardar(etapa.id, {
      name: nombre.trim(),
      color,
      // Desmarcar la etapa de entrada dejaría el embudo sin puerta, y el
      // servidor lo rechaza. Solo se manda cuando se está marcando.
      ...(inicial && !esEntrada ? { isInitial: true } : {}),
    });
    setGuardando(false);
    if (ok) onCerrar();
  }

  return (
    <div className="space-y-3 border-t border-line-default px-3 py-3">
      <div>
        <label
          htmlFor={idNombre}
          className="mb-1.5 block text-xs font-medium text-content-secondary"
        >
          Nombre
        </label>
        <input
          id={idNombre}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="w-full max-w-xs rounded-md border border-line-default px-2.5 py-1.5 text-sm text-content-primary outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
        />
      </div>

      <SelectorDeColor
        valor={color}
        onChange={setColor}
        grupo={`color-etapa-${etapa.id}`}
        etiqueta="Color de la etapa"
      />

      <label className="flex items-start gap-2 text-xs text-content-primary">
        <input
          type="checkbox"
          checked={inicial}
          disabled={esEntrada}
          onChange={(e) => setInicial(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
        />
        <span>
          Marcar como etapa inicial
          <span className="mt-0.5 block text-content-secondary">
            {esEntrada
              ? "Ya es la etapa por la que entran las oportunidades nuevas. Para cambiarla, marca otra."
              : "Aquí caerán las oportunidades que cree el sistema al recibir un mensaje nuevo."}
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="accent"
          disabled={guardando || !nombre.trim()}
          onClick={() => void guardar()}
        >
          {guardando ? "Guardando…" : "Guardar cambios"}
        </Button>
        <Button size="sm" variant="quiet" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
