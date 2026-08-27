"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Bot,
  ArrowLeft,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Target,
  UserRound,
  X,
} from "lucide-react";
import { getPerfilComercial, clavePerfil } from "@/lib/perfil";
import { archiveContact, restoreContact } from "@/lib/contacts";
import { Badge } from "@/components/ui/Badge";
import { TextoLargo } from "@/components/ui/TextoLargo";
import { SugerenciasDeTarea } from "@/components/tasks/SugerenciasDeTarea";
import { mensajeDeError } from "@/components/ui/ListState";
import { NOMBRE_PULSO } from "@/lib/producto";
import { isSafeInternalPath } from "@/lib/safe-url";

const PRIORIDAD: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

const ESTADO_COTIZACION: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
};

function moneda(v: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * El perfil comercial de una persona. EL MISMO en Pipeline y en Conversaciones.
 *
 * Lateral en escritorio, cajón a pantalla completa en móvil. No duplica
 * consultas: pide el contrato `/contacts/:id/perfil`, que resuelve el servidor
 * de una vez, y comparte la entrada de caché con la otra pantalla.
 *
 * `origen` decide qué acción de navegación tiene sentido: desde el Pipeline se
 * ofrece saltar al chat; desde el chat, volver al embudo por donde se vino.
 */
type Pestana = "resumen" | "datos" | "actividad";

const PESTANAS: ReadonlyArray<{ clave: Pestana; etiqueta: string }> = [
  { clave: "resumen", etiqueta: "Resumen" },
  { clave: "datos", etiqueta: "Datos" },
  { clave: "actividad", etiqueta: "Actividad" },
];

export function PerfilComercial({
  contactId,
  origen,
  volverA,
  rutaDeRegreso,
  oportunidadPreferidaId,
  variante = "lateral",
  onCerrar,
}: {
  contactId: string;
  origen: "pipeline" | "conversacion";
  /**
   * Qué oportunidad enseñar cuando el contacto tiene varias abiertas.
   *
   * Sin esto, la ficha enseña siempre la ABIERTA MÁS RECIENTE, que es lo
   * correcto al llegar desde un chat —no se ha señalado ninguna— pero no al
   * llegar desde el embudo: ahí se ha pulsado una tarjeta concreta, y ver los
   * datos de otra oportunidad del mismo contacto es peor que no abrir la
   * ficha. Es un dato que ya viaja en `oportunidades`; no añade consultas.
   */
  oportunidadPreferidaId?: string | null;
  /** Ruta de regreso, ya codificada. Conserva embudo, filtros y scroll. */
  volverA?: string | null;
  /**
   * Dónde volver desde el perfil completo. Lleva la conversación abierta y los
   * filtros, para que «Ver perfil completo» y luego «Volver» devuelva al MISMO
   * hilo y no a la bandeja de cero.
   */
  rutaDeRegreso?: string;
  /**
   * `lateral`: columna fija desde `lg` (embudo). `cajon`: columna fija desde
   * `xl` y cajón superpuesto por debajo — a 1024 los tres paneles no caben sin
   * dejar el hilo inservible, así que la ficha se superpone.
   */
  variante?: "lateral" | "cajon";
  onCerrar: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("resumen");

  const {
    data: perfil,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: clavePerfil(contactId),
    queryFn: () => getPerfilComercial(contactId),
  });

  // La preferida si está en la lista; si no, la que resuelve el servidor.
  const oportunidad =
    (oportunidadPreferidaId &&
      perfil?.oportunidades.find((o) => o.id === oportunidadPreferidaId)) ||
    perfil?.oportunidad ||
    null;

  async function conAviso(accion: () => Promise<unknown>, respaldo: string) {
    setError(null);
    setOcupado(true);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: clavePerfil(contactId) });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      await queryClient.invalidateQueries({ queryKey: ["kanban"] });
    } catch (e) {
      setError(mensajeDeError(e) || respaldo);
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Al chat EXACTO, no a la bandeja.
   *
   * Llevar a la lista de conversaciones y que el asesor busque a la persona que
   * acaba de mirar es justo donde se pierde el seguimiento. Se arrastra la ruta
   * de regreso para que volver no sea empezar de cero.
   */
  function abrirConversacion(conversationId: string) {
    const destino = new URLSearchParams({ c: conversationId });
    const regreso =
      volverA ?? `${window.location.pathname}${window.location.search}`;
    destino.set("volverA", regreso);
    router.push(`/dashboard/conversations?${destino.toString()}`);
  }

  const cuerpo = (
    <>
      {isLoading && (
        <p className="flex items-center gap-2 p-4 text-sm text-neutral-500">
          <Loader2 size={15} className="animate-spin" />
          Cargando el perfil…
        </p>
      )}

      {isError && (
        <div className="p-4">
          <p className="rounded-md bg-status-error-surface px-3 py-2 text-sm text-status-error">
            No se pudo cargar el perfil.
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Reintentar
          </button>
        </div>
      )}

      {perfil && (
        <div className="space-y-4 p-4">
          {/* Identidad */}
          <div>
            <h3 className="text-base font-semibold text-neutral-900">
              {perfil.contacto.nombre || perfil.contacto.telefono}
            </h3>
            <p className="font-mono text-sm text-neutral-600">
              {perfil.contacto.telefono}
            </p>
            {perfil.contacto.email && (
              <p className="text-sm text-neutral-500">
                <TextoLargo valor={perfil.contacto.email} />
              </p>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              <TextoLargo valor={perfil.empresa.nombre} />
            </p>

            {perfil.contacto.etiquetas.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {perfil.contacto.etiquetas.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {perfil.contacto.archivadoEn && (
              <p className="mt-2 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600">
                Archivado
                {perfil.contacto.motivoDeArchivo
                  ? `: ${perfil.contacto.motivoDeArchivo}`
                  : "."}{" "}
                Su historial se conserva.
              </p>
            )}
          </div>

          {/* Acciones rápidas */}
          <div className="flex flex-wrap gap-2">
            {perfil.conversacion && origen === "pipeline" && (
              <button
                onClick={() => abrirConversacion(perfil.conversacion!.id)}
                className="flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white hover:bg-primary-900"
              >
                <MessageSquare size={14} />
                Abrir conversación
              </button>
            )}

            {isSafeInternalPath(volverA) && origen === "conversacion" && (
              <button
                onClick={() => router.push(volverA)}
                className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <ArrowLeft size={14} />
                Volver al embudo
              </button>
            )}

            {oportunidad && (
              <button
                onClick={() =>
                  router.push(
                    `/dashboard/pipeline?embudo=${oportunidad.pipeline.id}&lead=${oportunidad.id}&sel=${oportunidad.id}`,
                  )
                }
                className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <Target size={14} />
                Abrir oportunidad
              </button>
            )}

            {!perfil.contacto.anonimizado &&
              (perfil.contacto.archivadoEn ? (
                <button
                  disabled={ocupado}
                  onClick={() =>
                    void conAviso(
                      () => restoreContact(contactId),
                      "No se pudo restaurar el contacto.",
                    )
                  }
                  className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                >
                  <ArchiveRestore size={14} />
                  Restaurar
                </button>
              ) : (
                <button
                  disabled={ocupado}
                  onClick={() =>
                    void conAviso(
                      () => archiveContact(contactId),
                      "No se pudo archivar el contacto.",
                    )
                  }
                  className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                >
                  <Archive size={14} />
                  Archivar
                </button>
              ))}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-status-error-surface px-3 py-2 text-sm text-status-error"
            >
              {error}
            </p>
          )}

          {/* Pestañas del mockup: la ficha lateral es estrecha y apilarlo todo
              obliga a desplazarse para llegar a lo que se venía a mirar. Es
              agrupación, no contenido nuevo: nada desaparece. */}
          <div
            role="tablist"
            aria-label="Secciones del perfil"
            className="flex gap-1 border-b border-neutral-200"
          >
            {PESTANAS.map((p) => (
              <button
                key={p.clave}
                type="button"
                role="tab"
                aria-selected={pestana === p.clave}
                onClick={() => setPestana(p.clave)}
                className={`-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-line-focus ${
                  pestana === p.clave
                    ? "border-brand-secondary text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>

          {/* Pulso: qué hace el bot AHORA. Va arriba porque decide si se
              puede escribir sin pisar al bot. */}
          {pestana === "resumen" && perfil.pulso && (
            <Seccion titulo={NOMBRE_PULSO}>
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2">
                  <Bot size={14} className="text-neutral-400" />
                  <span className="text-neutral-800">{perfil.pulso.bot}</span>
                </p>
                {perfil.pulso.esperando && (
                  <p className="text-xs text-neutral-600">
                    El bot está esperando. Si escribes tú, la conversación pasa
                    a atenderla una persona.
                  </p>
                )}
                {perfil.pulso.yaPasoAPersona && (
                  <p className="text-xs text-status-info">
                    El bot ya la pasó a una persona.
                  </p>
                )}
                <Link
                  href={`/dashboard/flowbots/executions/${perfil.pulso.ejecucionId}`}
                  className="inline-block text-xs text-brand-primary hover:underline"
                >
                  Ver el recorrido completo
                </Link>
              </div>
            </Seccion>
          )}

          {pestana === "resumen" && (
          <Seccion titulo="Oportunidad">
            {oportunidad ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-neutral-900">
                  {oportunidad.titulo}
                </p>
                <Fila etiqueta="Embudo" valor={oportunidad.pipeline.nombre} />
                <Fila etiqueta="Etapa" valor={oportunidad.etapa.nombre} />
                <Fila
                  etiqueta="Valor"
                  valor={moneda(oportunidad.valor)}
                  mono
                />
                <Fila
                  etiqueta="Asesor"
                  valor={oportunidad.asesor?.nombre ?? "Sin asignar"}
                />
              </div>
            ) : (
              <Vacio>Sin oportunidad abierta.</Vacio>
            )}
          </Seccion>
          )}

          {pestana === "resumen" && (
          <Seccion titulo="Último mensaje">
            {perfil.conversacion?.ultimoMensaje ? (
              <div className="text-sm">
                <p className="text-neutral-700">
                  {perfil.conversacion.ultimoMensaje.entrante
                    ? "Escribió: "
                    : "Respondimos: "}
                  <span className="text-neutral-900">
                    {perfil.conversacion.ultimoMensaje.cuerpo || "(sin texto)"}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {fechaCorta(perfil.conversacion.ultimoMensaje.fecha)}
                </p>
              </div>
            ) : (
              <Vacio>Todavía no hay mensajes.</Vacio>
            )}
          </Seccion>
          )}

          {/* Propuestas: van ANTES de las tareas porque son lo que espera una
              decisión, y una decisión pendiente es más urgente que una lista. */}
          {pestana === "resumen" && (
            <SugerenciasDeTarea contactId={contactId} titulo="Propuestas" />
          )}

          {pestana === "resumen" && (
          <Seccion
            titulo={`Tareas pendientes (${perfil.tareasPendientes.length})`}
          >
            {perfil.tareasPendientes.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {perfil.tareasPendientes.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-2"
                  >
                    <span className="text-neutral-800">{t.titulo}</span>
                    <Badge tone="neutral">
                      {PRIORIDAD[t.prioridad] ?? t.prioridad}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Nada pendiente.</Vacio>
            )}
          </Seccion>
          )}

          {pestana === "datos" && (
          <Seccion titulo="Cotizaciones">
            {perfil.cotizaciones.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {perfil.cotizaciones.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-1.5 text-neutral-800">
                      <FileText size={13} className="text-neutral-400" />
                      {c.numero}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-neutral-700">
                        {moneda(c.total)}
                      </span>
                      <Badge tone="neutral">
                        {ESTADO_COTIZACION[c.estado] ?? c.estado}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Todavía no se ha cotizado.</Vacio>
            )}
          </Seccion>
          )}

          {/* Campos personalizados */}
          {pestana === "datos" && perfil.camposPersonalizados.length > 0 && (
            <Seccion titulo="Datos adicionales">
              <div className="space-y-1 text-sm">
                {perfil.camposPersonalizados.map((c) => (
                  <Fila key={c.key} etiqueta={c.label} valor={c.valor ?? "—"} />
                ))}
              </div>
            </Seccion>
          )}

          {pestana === "actividad" && (
          <Seccion titulo="Actividad">
            {perfil.actividad.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {perfil.actividad.map((a, i) => (
                  <li
                    key={`${a.fecha}-${i}`}
                    className="flex justify-between gap-2"
                  >
                    <span className="text-neutral-700">{a.descripcion}</span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {fechaCorta(a.fecha)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Sin movimientos todavía.</Vacio>
            )}
          </Seccion>
          )}
        </div>
      )}
    </>
  );

  const enlacePerfilCompleto = `/dashboard/contacts/${contactId}${
    rutaDeRegreso ? `?volverA=${encodeURIComponent(rutaDeRegreso)}` : ""
  }`;

  return (
    <aside
      // Dos presentaciones de LA MISMA pieza. `lateral` es la del embudo, que
      // ya funcionaba. `cajon` retrasa la columna fija hasta `xl` porque a
      // 1024 px tres columnas dejan el hilo en una rendija: por debajo de ese
      // ancho la ficha se superpone sobre el hilo y se cierra.
      className={
        variante === "cajon"
          ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-neutral-200 bg-white shadow-xl xl:static xl:inset-auto xl:w-72 xl:max-w-none xl:shrink-0 xl:shadow-none 2xl:w-80"
          : "fixed inset-0 z-40 flex flex-col bg-white lg:static lg:inset-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-neutral-200"
      }
      aria-label="Perfil del contacto"
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <UserRound size={15} className="text-neutral-400" />
          Perfil
        </span>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el perfil"
          className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{cuerpo}</div>

      {/* Al perfil 360. Va en un pie fijo y no al final del scroll: en la
          ficha estrecha, «ver más» al fondo de una columna larga es un enlace
          que nadie encuentra. */}
      <div className="border-t border-neutral-200 px-4 py-2.5">
        <Link
          href={enlacePerfilCompleto}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ExternalLink size={14} aria-hidden="true" />
          Ver perfil completo
        </Link>
      </div>
    </aside>
  );
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {titulo}
      </h4>
      {children}
    </section>
  );
}

function Fila({
  etiqueta,
  valor,
  mono,
}: {
  etiqueta: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    // Etiqueta arriba, valor debajo. Enfrentados en una ficha de 288 px, un
    // «PREVIEW_BRANDING_Administrador» empujaba el panel y le salia scroll
    // horizontal propio. Apilados, el valor dispone del ancho entero.
    <p className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral-500">{etiqueta}</span>
      <span className="min-w-0 text-neutral-900">
        <TextoLargo valor={valor} mono={mono} />
      </span>
    </p>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-400">{children}</p>;
}
