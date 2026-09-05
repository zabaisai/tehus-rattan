"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DragStart,
  DragUpdate,
  DropResult,
  ResponderProvided,
} from "@hello-pangea/dnd";
import { DragDropContext } from "@hello-pangea/dnd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KanbanSquare } from "lucide-react";
import { getKanban, changeLeadStage, updateStage } from "@/lib/pipeline";
import { getPerfilComercial, clavePerfil } from "@/lib/perfil";
import { ListState, mensajeDeError } from "@/components/ui/ListState";
import { Skeleton } from "@/components/ui/Skeleton";
import { EtapaVertical } from "./EtapaVertical";
import { filtrarEtapas } from "@/lib/pipeline-url";
import type { KanbanData, Lead, Pipeline } from "@/types";
import type { RegionDeMoneda } from "@/lib/dinero";

/**
 * El tablero del embudo, VERTICAL (mockup 04).
 *
 * Sustituye al kanban horizontal. No convive con él: dos tableros que mueven
 * las mismas oportunidades con dos reglas de arrastre distintas es justo la
 * clase de duplicado que este plan prohíbe, y el horizontal ya no tenía
 * pantalla que lo usara.
 *
 * EL MOVIMIENTO ES OPTIMISTA CON VUELTA ATRÁS VISIBLE. La tarjeta salta de
 * etapa al soltarla y, si el servidor la rechaza, vuelve a su sitio con un
 * aviso escrito. Es lo que permite el §5.2: optimismo solo donde hay reversión
 * clara.
 */
export function TableroVertical({
  embudo,
  filtro,
  seleccion,
  plegadas,
  puedeAdministrar,
  onPlegar,
  onSeleccionar,
  onAbrirOportunidad,
  onAgregar,
  region,
}: {
  /** Moneda e idioma de la empresa. Opcional: sin ella usa el del producto. */
  region?: RegionDeMoneda;
  embudo: Pipeline;
  filtro: { q: string; asesor: string | null };
  seleccion: string | null;
  plegadas: string[];
  puedeAdministrar: boolean;
  onPlegar: (etapaId: string, plegada: boolean) => void;
  onSeleccionar: (lead: Lead) => void;
  onAbrirOportunidad: (lead: Lead) => void;
  onAgregar: (etapaId: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const clave = ["kanban", embudo.id];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: clave,
    queryFn: () => getKanban(embudo.id),
  });

  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * Mueve la tarjeta en la caché y la persiste. Si falla, revierte.
   *
   * Recalcula `leadCount` y `totalValue` de las dos etapas implicadas: sin
   * eso, la cabecera seguiría diciendo «12 oportunidades · $12.400.000»
   * mientras se ven once tarjetas, hasta que llegara la siguiente carga.
   */
  async function mover(leadId: string, destinoId: string, posicion?: number) {
    const previo = queryClient.getQueryData<KanbanData>(clave);
    if (!previo) return;

    const origen = previo.stages.find((s) =>
      s.leads.some((l) => l.id === leadId),
    );
    if (!origen) return;
    if (origen.id === destinoId && posicion === undefined) return;

    const siguiente: KanbanData = structuredClone(previo);
    const desde = siguiente.stages.find((s) => s.id === origen.id)!;
    const hasta = siguiente.stages.find((s) => s.id === destinoId);
    if (!hasta) return;

    const i = desde.leads.findIndex((l) => l.id === leadId);
    const [tarjeta] = desde.leads.splice(i, 1);
    tarjeta.stageId = destinoId;
    hasta.leads.splice(posicion ?? hasta.leads.length, 0, tarjeta);

    for (const etapa of [desde, hasta]) {
      etapa.leadCount = etapa.leads.length;
      etapa.totalValue = etapa.leads.reduce((s, l) => s + (l.value ?? 0), 0);
    }

    queryClient.setQueryData(clave, siguiente);
    setAviso(null);

    if (origen.id === destinoId) return;

    try {
      await changeLeadStage(leadId, destinoId);
      // La ficha lateral enseña la etapa de la oportunidad: si no se refresca,
      // el panel sigue diciendo «Nuevo» con la tarjeta ya en «Cotizado».
      await queryClient.invalidateQueries({ queryKey: ["perfil"] });
    } catch (e) {
      queryClient.setQueryData(clave, previo);
      setAviso(
        mensajeDeError(e) ||
          `No se pudo mover «${tarjeta.title}». Sigue en ${origen.name}.`,
      );
    }
  }

  /**
   * Los anuncios del arrastre, EN ESPAÑOL.
   *
   * La biblioteca trae los suyos —«You have lifted an item in position 1»— y
   * son lo único que oye quien mueve una oportunidad sin ver la pantalla. Un
   * producto en español que da sus instrucciones de teclado en inglés no es
   * accesible: es traducido a medias. Además se nombra la etapa y no el
   * identificador de la lista, que es lo que anuncia por defecto.
   */
  function nombreDeEtapa(id: string): string {
    return data?.stages.find((s) => s.id === id)?.name ?? "otra etapa";
  }

  function alLevantar(inicio: DragStart, provided: ResponderProvided) {
    provided.announce(
      `Has levantado la oportunidad de la etapa ${nombreDeEtapa(inicio.source.droppableId)}. ` +
        "Usa las flechas para llevarla a otra etapa, espacio para soltarla y Escape para cancelar.",
    );
  }

  function alActualizar(cambio: DragUpdate, provided: ResponderProvided) {
    provided.announce(
      cambio.destination
        ? `Sobre la etapa ${nombreDeEtapa(cambio.destination.droppableId)}, posición ${cambio.destination.index + 1}.`
        : "Fuera de cualquier etapa. Si sueltas aquí, la oportunidad no se mueve.",
    );
  }

  function alSoltar(resultado: DropResult, provided: ResponderProvided) {
    const { source, destination, draggableId } = resultado;

    if (!destination) {
      provided.announce("Movimiento cancelado. La oportunidad sigue donde estaba.");
      return;
    }
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      provided.announce("La oportunidad se queda en su sitio.");
      return;
    }

    provided.announce(
      `Oportunidad movida a la etapa ${nombreDeEtapa(destination.droppableId)}.`,
    );
    void mover(draggableId, destination.droppableId, destination.index);
  }

  /**
   * Al chat EXACTO de esa oportunidad, no a la bandeja.
   *
   * El tablero no trae la conversación en su contrato, así que se resuelve con
   * el MISMO perfil comercial que alimenta el panel lateral y bajo su misma
   * clave de caché: si el panel ya está abierto, no hay ida al servidor; si no
   * lo está, la respuesta queda lista para cuando se abra.
   */
  async function abrirConversacion(lead: Lead) {
    setAviso(null);
    try {
      const perfil = await queryClient.fetchQuery({
        queryKey: clavePerfil(lead.contact.id),
        queryFn: () => getPerfilComercial(lead.contact.id),
      });

      if (!perfil.conversacion) {
        setAviso(
          `${lead.contact.name || lead.contact.phone} todavía no tiene ninguna conversación abierta.`,
        );
        return;
      }

      const destino = new URLSearchParams({ c: perfil.conversacion.id });
      destino.set(
        "volverA",
        `${window.location.pathname}${window.location.search}`,
      );
      router.push(`/dashboard/conversations?${destino.toString()}`);
    } catch (e) {
      setAviso(mensajeDeError(e) || "No se pudo abrir la conversación.");
    }
  }

  /** Guarda nombre, color o etapa de entrada. Devuelve si el servidor lo aceptó. */
  async function guardarEtapa(
    etapaId: string,
    cambios: { name?: string; color?: string | null; isInitial?: boolean },
  ): Promise<boolean> {
    setAviso(null);
    try {
      await updateStage(embudo.id, etapaId, {
        ...(cambios.name !== undefined ? { name: cambios.name } : {}),
        ...(cambios.isInitial !== undefined
          ? { isInitial: cambios.isInitial }
          : {}),
        // El contrato admite `color` como texto; «sin color» viaja como cadena
        // vacía, que es lo que el servidor guarda como nulo.
        ...(cambios.color !== undefined ? { color: cambios.color ?? "" } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      await queryClient.invalidateQueries({ queryKey: ["kanban", embudo.id] });
      return true;
    } catch (e) {
      setAviso(mensajeDeError(e) || "No se pudo guardar la etapa.");
      return false;
    }
  }

  if (isLoading) {
    return (
      <div aria-busy="true" className="space-y-3">
        {embudo.stages.slice(0, 4).map((e) => (
          <Skeleton key={e.id} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ListState
        isLoading={false}
        isError
        isEmpty={false}
        error={error}
        onRetry={() => void refetch()}
        icon={KanbanSquare}
        emptyMessage=""
      />
    );
  }

  const hayFiltro = !!filtro.q || !!filtro.asesor;
  const etapas = filtrarEtapas(data.stages, filtro);
  const nombres = data.stages.map((s) => ({ id: s.id, name: s.name }));
  const porId = new Map(embudo.stages.map((s) => [s.id, s]));

  if (etapas.length === 0) {
    return (
      <ListState
        isLoading={false}
        isError={false}
        isEmpty
        icon={KanbanSquare}
        emptyMessage="Este embudo todavía no tiene etapas. Créalas desde «Configurar etapas»."
      />
    );
  }

  return (
    <div className="min-w-0">
      {aviso && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-status-error/20 bg-status-error-surface px-3 py-2 text-sm text-status-error"
        >
          {aviso}
        </p>
      )}

      <DragDropContext
        onDragStart={alLevantar}
        onDragUpdate={alActualizar}
        onDragEnd={alSoltar}
      >
        <div className="space-y-3">
          {etapas.map((etapa, i) => (
            <EtapaVertical
              region={region}
              key={etapa.id}
              etapa={etapa}
              configuracion={porId.get(etapa.id)}
              indice={i}
              etapas={nombres}
              plegada={plegadas.includes(etapa.id)}
              seleccion={seleccion}
              hayFiltro={hayFiltro}
              puedeAdministrar={puedeAdministrar}
              onPlegar={onPlegar}
              onAgregar={onAgregar}
              onSeleccionar={onSeleccionar}
              onAbrirOportunidad={onAbrirOportunidad}
              onAbrirConversacion={(lead) => void abrirConversacion(lead)}
              onMoverDeEtapa={(leadId, destino) => void mover(leadId, destino)}
              onGuardarEtapa={guardarEtapa}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}
