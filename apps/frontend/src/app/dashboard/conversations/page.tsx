"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, PlayCircle, ArrowLeft, PanelRight } from "lucide-react";
import {
  getInbox,
  getInboxCounters,
  bulkConversations,
  markConversationRead,
  getMessages,
  sendMessage,
  pauseConversation,
  resumeConversation,
  type AccionMasiva,
  type FiltrosBandeja,
} from "@/lib/conversations";
import { getCompanyUsers } from "@/lib/users";
import { ConversationList } from "@/components/conversations/ConversationList";
import { MessageThread } from "@/components/conversations/MessageThread";
import { MessageInput } from "@/components/conversations/MessageInput";
import { ConversationOpportunity } from "@/components/conversations/ConversationOpportunity";
import { PerfilComercial } from "@/components/perfil/PerfilComercial";
import { intervaloDeRefresco, useRealtime } from "@/lib/use-realtime";
import { InboxFilters } from "@/components/conversations/InboxFilters";
import { InboxBulkBar } from "@/components/conversations/InboxBulkBar";

function ConversationsContenido() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * La conversación abierta vive en la URL, no en estado local.
   *
   * Con estado local, recargar la página perdía el chat, no había deep link y
   * volver desde el embudo aterrizaba en la bandeja vacía. `volverA` guarda de
   * dónde se vino para que regresar conserve embudo, filtros y scroll.
   */
  const selectedId = params.get("c");
  const volverA = params.get("volverA");

  const setSelectedId = useCallback(
    (id: string | null) => {
      const siguiente = new URLSearchParams(params.toString());
      if (id) siguiente.set("c", id);
      else siguiente.delete("c");
      const cadena = siguiente.toString();
      router.replace(cadena ? `${pathname}?${cadena}` : pathname, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosBandeja>({});
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  // La ficha se abre a mano: en pantallas medianas robaría el sitio del hilo,
  // que es lo que se está leyendo.
  const [fichaAbierta, setFichaAbierta] = useState(false);

  // Con canal abierto los mensajes llegan solos; el polling se relaja pero no
  // desaparece, por si se pierde algun evento.
  const { enVivo } = useRealtime(selectedId);
  const refetchInterval = intervaloDeRefresco(enVivo);

  // La clave lleva los filtros: cada combinacion es una lista distinta y
  // compartir cache entre ellas mostraria resultados de otro filtro al
  // cambiar de pestana.
  const { data: bandeja } = useQuery({
    queryKey: ["conversations", filtros],
    queryFn: () => getInbox(filtros),
    refetchInterval,
  });

  const { data: contadores } = useQuery({
    queryKey: ["conversations", "counters"],
    queryFn: getInboxCounters,
    refetchInterval,
  });

  const { data: asesores } = useQuery({
    queryKey: ["users"],
    queryFn: getCompanyUsers,
    // La plantilla no cambia mientras se trabaja: pedirla con el mismo ritmo
    // que las conversaciones seria trafico por nada.
    staleTime: 5 * 60_000,
  });

  const conversations = useMemo(() => bandeja?.items ?? [], [bandeja]);

  const { data: messages } = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => getMessages(selectedId as string),
    enabled: !!selectedId,
    refetchInterval,
  });

  const selectedConversation =
    conversations.find((c) => c.id === selectedId) ?? null;

  const refrescarBandeja = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    [queryClient],
  );

  // Abrir un hilo lo marca leido. Va aqui y no en el onClick para que tambien
  // cuente cuando la seleccion viene de otro sitio, y para que un mensaje
  // nuevo en el hilo ya abierto no deje el contador encendido.
  useEffect(() => {
    if (!selectedId) return;
    let cancelado = false;
    void markConversationRead(selectedId)
      .then(() => {
        if (!cancelado) void refrescarBandeja();
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [selectedId, messages, refrescarBandeja]);

  function alternarSeleccion(id: string) {
    setSeleccionadas((previas) =>
      previas.includes(id) ? previas.filter((x) => x !== id) : [...previas, id],
    );
  }

  async function aplicarAccionMasiva(accion: AccionMasiva) {
    await bulkConversations(seleccionadas, accion);
    setSeleccionadas([]);
    await refrescarBandeja();
  }

  async function handleSend(message: string) {
    if (!selectedId) return;
    const created = await sendMessage(selectedId, message);
    await queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });

    setSendNotice(
      created.status === "FAILED"
        ? "El mensaje no se pudo enviar por WhatsApp. Quedó marcado como fallido en la conversación."
        : null,
    );
  }

  async function handleTogglePause() {
    if (!selectedConversation) return;
    if (selectedConversation.isPaused) {
      await resumeConversation(selectedConversation.id);
    } else {
      await pauseConversation(selectedConversation.id);
    }
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {/* Móvil: solo se muestra el listado O el chat, nunca ambos a la vez. */}
      <div
        className={`w-full shrink-0 overflow-y-auto border-neutral-200 sm:block sm:w-72 sm:border-r ${
          selectedId ? "hidden sm:block" : "block"
        }`}
      >
        <InboxFilters
          filtros={filtros}
          contadores={contadores}
          onChange={(siguiente) => {
            // La seleccion se limpia al cambiar de filtro: mantenerla dejaria
            // marcadas conversaciones que ya no se ven, y la accion masiva
            // afectaria a algo invisible.
            setSeleccionadas([]);
            setFiltros(siguiente);
          }}
        />

        <InboxBulkBar
          seleccionadas={seleccionadas}
          asesores={asesores ?? []}
          onAccion={aplicarAccionMasiva}
          onLimpiar={() => setSeleccionadas([])}
        />

        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={(id) => {
            setSendNotice(null);
            setSelectedId(id);
          }}
          seleccionadas={seleccionadas}
          onToggleSeleccion={alternarSeleccion}
        />
      </div>

      <div
        className={`flex-1 flex-col sm:flex ${selectedId ? "flex" : "hidden"}`}
      >
        {!selectedConversation && (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            Selecciona una conversación
          </div>
        )}

        {selectedConversation && (
          <>
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Volver al listado de conversaciones"
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 sm:hidden"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {selectedConversation.contact.name ||
                      selectedConversation.contact.phone}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {selectedConversation.contact.phone}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFichaAbierta((v) => !v)}
                  aria-label="Ver la ficha del contacto"
                  aria-pressed={fichaAbierta}
                  className={`rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-line-focus ${
                    fichaAbierta
                      ? "bg-primary-50 text-brand-primary"
                      : "text-neutral-500 hover:bg-neutral-100"
                  }`}
                >
                  <PanelRight size={16} />
                </button>
                <button
                  onClick={handleTogglePause}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    selectedConversation.isPaused
                      ? "bg-status-success-surface text-status-success-strong hover:bg-status-success/10"
                      : "bg-status-warning-surface text-status-warning-strong hover:bg-status-warning/10"
                  }`}
                >
                  {selectedConversation.isPaused ? (
                    <>
                      <PlayCircle size={14} />
                      Reanudar chatbot
                    </>
                  ) : (
                    <>
                      <PauseCircle size={14} />
                      Pausar chatbot
                    </>
                  )}
                </button>
              </div>
            </div>

            <ConversationOpportunity
              conversation={selectedConversation}
              onTaskCreated={() =>
                queryClient.invalidateQueries({ queryKey: ["tasks"] })
              }
            />

            {sendNotice && (
              <p className="border-b border-status-error/20 bg-status-error-surface px-4 py-2 text-xs font-medium text-status-error">
                {sendNotice}
              </p>
            )}

            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <MessageThread messages={messages ?? []} />
                <MessageInput onSend={handleSend} />
              </div>

              {fichaAbierta && selectedConversation.contact?.id && (
                <PerfilComercial
                  key={selectedConversation.contact.id}
                  contactId={selectedConversation.contact.id}
                  origen="conversacion"
                  volverA={volverA}
                  onCerrar={() => setFichaAbierta(false)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  // `useSearchParams` obliga a un límite de Suspense para que la página pueda
  // prerenderizarse; sin él, el build falla al generarla.
  return (
    <Suspense fallback={null}>
      <ConversationsContenido />
    </Suspense>
  );
}
