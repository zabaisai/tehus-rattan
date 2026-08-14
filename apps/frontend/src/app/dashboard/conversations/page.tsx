"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PauseCircle,
  PlayCircle,
  ArrowLeft,
  PanelRight,
  MessagesSquare,
} from "lucide-react";
import {
  getInbox,
  getInboxCounters,
  getConversation,
  bulkConversations,
  markConversationRead,
  getMessages,
  sendMessage,
  pauseConversation,
  resumeConversation,
  canalLegible,
  type AccionMasiva,
  type ConversacionBandeja,
} from "@/lib/conversations";
import {
  aplicarCambios,
  leerEstadoDeBandeja,
  queryDeEstado,
  type CambiosDeBandeja,
} from "@/lib/inbox-url";
import { getCompanyUsers } from "@/lib/users";
import { ConversationList } from "@/components/conversations/ConversationList";
import { MessageThread } from "@/components/conversations/MessageThread";
import { MessageInput } from "@/components/conversations/MessageInput";
import { ConversationOpportunity } from "@/components/conversations/ConversationOpportunity";
import { PerfilComercial } from "@/components/perfil/PerfilComercial";
import { intervaloDeRefresco, useRealtime } from "@/lib/use-realtime";
import { InboxFilters } from "@/components/conversations/InboxFilters";
import { InboxBulkBar } from "@/components/conversations/InboxBulkBar";
import { ListState, mensajeDeError } from "@/components/ui/ListState";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { Avatar } from "@/components/ui/Avatar";

/** Cuántas conversaciones se piden de golpe, y cuántas más al pulsar. */
const PAGINA = 30;
const TOPE = 100;

function codigoDeEstado(e: unknown): number | null {
  return (
    (e as { response?: { status?: number } })?.response?.status ?? null
  );
}

function InboxContenido() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * TODO lo que se está mirando vive en la URL: conversación, pestaña,
   * búsqueda, estado y si el perfil está abierto.
   *
   * Con los filtros en estado de React, recargar con «Sin leer» activo volvía a
   * «Todas» sin avisar, Atrás no deshacía un cambio de filtro —nunca hubo
   * entrada en el historial— y un enlace compartido llevaba a una bandeja
   * distinta de la que vio quien lo mandó. El códec vive en `lib/inbox-url`.
   */
  const estado = useMemo(
    () => leerEstadoDeBandeja(new URLSearchParams(params.toString())),
    [params],
  );
  const { filtros, conversacionId, perfilAbierto, volverA } = estado;

  const navegar = useCallback(
    (cambios: CambiosDeBandeja, modo: "push" | "replace" = "push") => {
      const q = queryDeEstado(aplicarCambios(estado, cambios));
      const url = q ? `${pathname}?${q}` : pathname;
      if (modo === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [estado, pathname, router],
  );

  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [limite, setLimite] = useState(PAGINA);

  /**
   * La búsqueda se teclea en local y viaja a la URL con retardo.
   *
   * Escribir una entrada de historial por pulsación dejaría el botón Atrás
   * inservible; y leer el valor directamente de la URL con retardo haría que el
   * campo pareciera trabado. Cuando la URL cambia por fuera —Atrás, un enlace—,
   * el texto se ajusta durante el render, que es el patrón que React documenta
   * para esto; un efecto aquí dispararía `set-state-in-effect`.
   */
  const busquedaEnUrl = filtros.search ?? "";
  const [textoBusqueda, setTextoBusqueda] = useState(busquedaEnUrl);
  const [busquedaAplicada, setBusquedaAplicada] = useState(busquedaEnUrl);
  if (busquedaAplicada !== busquedaEnUrl) {
    setBusquedaAplicada(busquedaEnUrl);
    setTextoBusqueda(busquedaEnUrl);
  }
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cambiarBusqueda = useCallback(
    (texto: string) => {
      setTextoBusqueda(texto);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => {
        setSeleccionadas([]);
        setLimite(PAGINA);
        navegar({ search: texto }, "replace");
      }, 300);
    },
    [navegar],
  );

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  // Escape cierra la ficha, como cualquier cajón. No cierra la conversación:
  // son dos cosas distintas y confundirlas hace perder el hilo que se leía.
  useEffect(() => {
    if (!perfilAbierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") navegar({ perfilAbierto: false }, "replace");
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [perfilAbierto, navegar]);

  // Con canal abierto los mensajes llegan solos; el polling se relaja pero no
  // desaparece, por si se pierde algun evento.
  const { enVivo } = useRealtime(conversacionId);
  const refetchInterval = intervaloDeRefresco(enVivo);

  // La clave lleva los filtros y el limite: cada combinacion es una lista
  // distinta y compartir cache entre ellas mostraria resultados de otro filtro.
  const bandeja = useQuery({
    queryKey: ["conversations", filtros, limite],
    queryFn: () => getInbox({ ...filtros, limit: limite }),
    refetchInterval,
  });

  const contadores = useQuery({
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

  const conversations = useMemo(
    () => bandeja.data?.items ?? [],
    [bandeja.data],
  );

  /**
   * Archivadas y cerradas van APARTE, como en el mockup.
   *
   * No es cosmético: `inbox/counters` cuenta solo las activas, así que con
   * todas mezcladas la pestaña decía «Todas 6» encima de una lista de siete.
   * Quien lo ve no sabe cuál de los dos números creer. Cuando se filtra por un
   * estado concreto no se separa nada: ahí lo archivado es justo lo que se pidió.
   */
  const separar = !filtros.status;
  const activas = useMemo(
    () =>
      separar
        ? conversations.filter(
            (c) => c.status !== "ARCHIVED" && c.status !== "CLOSED",
          )
        : conversations,
    [conversations, separar],
  );
  const cerradas = useMemo(
    () =>
      separar
        ? conversations.filter(
            (c) => c.status === "ARCHIVED" || c.status === "CLOSED",
          )
        : [],
    [conversations, separar],
  );
  const enLaLista = conversations.find((c) => c.id === conversacionId) ?? null;

  /**
   * Un enlace profundo puede apuntar a una conversación que NO está en la
   * página cargada: archivada, fuera del filtro activo o más abajo de las
   * treinta primeras. Antes eso enseñaba «Selecciona una conversación», que es
   * exactamente el enlace roto que el mockup quiere evitar. Se pide suelta.
   */
  const suelta = useQuery({
    queryKey: ["conversations", "detalle", conversacionId],
    queryFn: () => getConversation(conversacionId as string),
    enabled: Boolean(conversacionId) && !enLaLista,
    retry: false,
    refetchInterval,
  });

  const selectedConversation = (enLaLista ??
    suelta.data ??
    null) as ConversacionBandeja | null;

  const mensajes = useQuery({
    queryKey: ["messages", conversacionId],
    queryFn: () => getMessages(conversacionId as string),
    enabled: Boolean(conversacionId),
    refetchInterval,
  });

  const refrescarBandeja = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    [queryClient],
  );

  // Abrir un hilo lo marca leido. Va aqui y no en el onClick para que tambien
  // cuente cuando la seleccion viene de otro sitio, y para que un mensaje
  // nuevo en el hilo ya abierto no deje el contador encendido.
  useEffect(() => {
    if (!conversacionId) return;
    let cancelado = false;
    void markConversationRead(conversacionId)
      .then(() => {
        if (!cancelado) void refrescarBandeja();
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [conversacionId, mensajes.data, refrescarBandeja]);

  function elegirConversacion(id: string) {
    setSendNotice(null);
    navegar({ conversacionId: id });
  }

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
    if (!conversacionId) return;
    const created = await sendMessage(conversacionId, message);
    await queryClient.invalidateQueries({
      queryKey: ["messages", conversacionId],
    });
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

  const estadoLista = codigoDeEstado(bandeja.error);
  const sinPermisoEnLista = estadoLista === 403;
  const hayFiltros = Boolean(filtros.search || filtros.status);
  const estadoSuelta = codigoDeEstado(suelta.error);
  const totalMostrado = conversations.length;

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {/* ── Panel izquierdo: la bandeja ─────────────────────────── */}
      <section
        aria-label="Conversaciones"
        className={`flex min-h-0 w-full shrink-0 flex-col border-neutral-200 md:flex md:w-[17rem] md:border-r 2xl:w-[19rem] ${
          conversacionId ? "hidden md:flex" : "flex"
        }`}
      >
        <header className="flex items-baseline gap-2 px-3 pt-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Conversaciones
          </h2>
          {contadores.data && (
            <span className="rounded-full bg-secondary-500 px-1.5 text-[11px] font-semibold text-brand-primary">
              {contadores.data.total}
            </span>
          )}
        </header>

        <InboxFilters
          filtros={filtros}
          contadores={contadores.data}
          textoBusqueda={textoBusqueda}
          onBuscar={cambiarBusqueda}
          onChange={(cambios) => {
            // La seleccion se limpia al cambiar de filtro: mantenerla dejaria
            // marcadas conversaciones que ya no se ven, y la accion masiva
            // afectaria a algo invisible.
            setSeleccionadas([]);
            setLimite(PAGINA);
            navegar(cambios);
          }}
        />

        <InboxBulkBar
          seleccionadas={seleccionadas}
          asesores={asesores ?? []}
          onAccion={aplicarAccionMasiva}
          onLimpiar={() => setSeleccionadas([])}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sinPermisoEnLista ? (
            <ForbiddenState
              className="m-3"
              titulo="No puedes ver esta bandeja"
              detalle="Las conversaciones las ven los roles con acceso a la empresa activa."
            />
          ) : (
            <>
              <ListState
                isLoading={bandeja.isLoading}
                isError={bandeja.isError}
                isEmpty={totalMostrado === 0}
                error={bandeja.error}
                onRetry={() => void bandeja.refetch()}
                icon={MessagesSquare}
                loadingMessage="Cargando conversaciones…"
                emptyMessage={
                  hayFiltros
                    ? "Ninguna conversación coincide con lo que buscas."
                    : "Todavía no hay conversaciones."
                }
              />

              {totalMostrado > 0 && (
                <>
                  <ConversationList
                    conversations={activas}
                    selectedId={conversacionId}
                    onSelect={elegirConversacion}
                    seleccionadas={seleccionadas}
                    onToggleSeleccion={alternarSeleccion}
                  />

                  {cerradas.length > 0 && (
                    <>
                      <h3 className="border-y border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                        Archivado
                      </h3>
                      <ConversationList
                        conversations={cerradas}
                        selectedId={conversacionId}
                        onSelect={elegirConversacion}
                        seleccionadas={seleccionadas}
                        onToggleSeleccion={alternarSeleccion}
                      />
                    </>
                  )}

                  <div className="px-3 py-3 text-center">
                    {bandeja.data?.hasMore && limite < TOPE ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLimite((n) => Math.min(n + PAGINA, TOPE))
                        }
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors duration-150 hover:bg-neutral-50"
                      >
                        Cargar más conversaciones
                      </button>
                    ) : (
                      <p className="text-[11px] text-neutral-400">
                        {bandeja.data?.hasMore
                          ? `Mostrando las ${totalMostrado} más recientes. Usa los filtros o la búsqueda para acotar.`
                          : `Mostrando ${activas.length} activa${activas.length === 1 ? "" : "s"}${
                              cerradas.length ? ` y ${cerradas.length} archivada${cerradas.length === 1 ? "" : "s"}` : ""
                            }`}
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Panel central: el hilo ──────────────────────────────── */}
      <section
        aria-label="Conversación"
        className={`min-w-0 flex-1 flex-col md:flex ${
          conversacionId ? "flex" : "hidden"
        }`}
      >
        {!conversacionId && (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-neutral-400">
            Elige una conversación de la lista para leerla aquí.
          </div>
        )}

        {conversacionId && !selectedConversation && (
          <div className="flex flex-1 items-center justify-center px-6">
            {suelta.isLoading ? (
              <p className="text-sm text-neutral-400">Abriendo la conversación…</p>
            ) : estadoSuelta === 403 ? (
              <ForbiddenState
                titulo="No puedes ver esta conversación"
                detalle="Pertenece a la empresa, pero tu rol no la alcanza."
              />
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-neutral-700">
                  Esa conversación ya no está disponible.
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Puede haberse cerrado, o el enlace apunta a otra empresa.
                </p>
                <button
                  type="button"
                  onClick={() => navegar({ conversacionId: null })}
                  className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Volver a la bandeja
                </button>
              </div>
            )}
          </div>
        )}

        {selectedConversation && (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => navegar({ conversacionId: null })}
                  aria-label="Volver al listado de conversaciones"
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 md:hidden"
                >
                  <ArrowLeft size={18} />
                </button>
                <Avatar
                  nombre={
                    selectedConversation.contact.name ||
                    selectedConversation.contact.phone
                  }
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {selectedConversation.contact.name ||
                      selectedConversation.contact.phone}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    <span className="font-mono">
                      {selectedConversation.contact.phone}
                    </span>
                    {" · "}
                    {canalLegible(selectedConversation.channel)}
                    {selectedConversation.agent
                      ? ` · ${selectedConversation.agent.name}`
                      : " · Sin asignar"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    navegar({ perfilAbierto: !perfilAbierto }, "replace")
                  }
                  aria-label={
                    perfilAbierto
                      ? "Ocultar la ficha del contacto"
                      : "Ver la ficha del contacto"
                  }
                  aria-pressed={perfilAbierto}
                  className={`rounded-md p-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-line-focus ${
                    perfilAbierto
                      ? "bg-primary-50 text-brand-primary"
                      : "text-neutral-500 hover:bg-neutral-100"
                  }`}
                >
                  <PanelRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
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
            </header>

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

            {mensajes.isError ? (
              <div className="flex flex-1 items-center justify-center px-6">
                <div className="text-center">
                  <p role="alert" className="text-sm text-status-error">
                    {mensajeDeError(mensajes.error) ||
                      "No se pudieron cargar los mensajes."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void mensajes.refetch()}
                    className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            ) : (
              <MessageThread messages={mensajes.data ?? []} />
            )}

            <MessageInput onSend={handleSend} />
          </>
        )}
      </section>

      {/* ── Panel derecho: la ficha ─────────────────────────────── */}
      {/* Telón solo por debajo de xl, que es donde la ficha se superpone al
          hilo. Sin él, el cajón tapa el chat y no hay forma evidente de
          quitarlo salvo dar con la equis. Desde xl la ficha es una columna más
          y un telón sobre la pantalla entera sería absurdo. */}
      {perfilAbierto && selectedConversation?.contact?.id && (
        <button
          type="button"
          aria-label="Cerrar el perfil"
          onClick={() => navegar({ perfilAbierto: false }, "replace")}
          className="fixed inset-0 z-30 cursor-default bg-neutral-900/30 xl:hidden"
        />
      )}
      {perfilAbierto && selectedConversation?.contact?.id && (
        <PerfilComercial
          key={selectedConversation.contact.id}
          contactId={selectedConversation.contact.id}
          origen="conversacion"
          variante="cajon"
          volverA={volverA}
          rutaDeRegreso={`${pathname}?${queryDeEstado(estado)}`}
          onCerrar={() => navegar({ perfilAbierto: false }, "replace")}
        />
      )}
    </div>
  );
}

export default function ConversationsPage() {
  // `useSearchParams` obliga a un límite de Suspense para que la página pueda
  // prerenderizarse; sin él, el build falla al generarla.
  return (
    <Suspense fallback={null}>
      <InboxContenido />
    </Suspense>
  );
}
