"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Banknote,
  CheckSquare,
  FileText,
  ListChecks,
  MessageSquare,
  Paperclip,
  Target,
} from "lucide-react";
import { getPerfilComercial, clavePerfil, type PerfilComercial } from "@/lib/perfil";
import { getCanonico, clavesDeFusion } from "@/lib/fusion";
import { canalLegible } from "@/lib/conversations";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { TextoLargo } from "@/components/ui/TextoLargo";

/**
 * Perfil 360 de un contacto (mockup 18).
 *
 * Estructura del mockup, datos del contrato. Las cifras que el mockup enseña y
 * el producto no tiene —«calidad del dato 96 %», «relación activa 82 %»,
 * «última compra»— no se dibujan: inventarlas sería peor que no ponerlas. Todo
 * lo demás sí está, con conteos reales de `resumen` y estados vacíos honestos
 * cuando la relación no existe.
 *
 * No duplica consultas: pide el MISMO `/contacts/:id/perfil` que la ficha
 * lateral y comparte con ella la entrada de caché.
 */

type Pestana =
  | "actividad"
  | "conversaciones"
  | "oportunidades"
  | "tareas"
  | "cotizaciones"
  | "documentos";

function moneda(v: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const ESTADO_COTIZACION: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
};

const PRIORIDAD: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

const ESTADO_OPORTUNIDAD: Record<string, string> = {
  OPEN: "Abierta",
  WON: "Ganada",
  LOST: "Perdida",
};

const ESTADO_CONVERSACION: Record<string, string> = {
  OPEN: "Abierta",
  PENDING: "Pendiente",
  RESOLVED: "Resuelta",
  CLOSED: "Cerrada",
  ARCHIVED: "Archivada",
};

function Perfil360({ contactId }: { contactId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const volverA = params.get("volverA");
  const [pestana, setPestana] = useState<Pestana>("actividad");
  const refActiva = useRef<HTMLButtonElement>(null);

  /**
   * La pestaña activa, siempre a la vista.
   *
   * En pantallas donde la barra se desplaza, cambiar de pestaña desde una
   * métrica podía dejarla fuera del recuadro visible: se veía el contenido
   * cambiar sin ver cuál se había activado. Solo mueve el scroll de la barra,
   * no el de la página.
   */
  useEffect(() => {
    refActiva.current?.scrollIntoView?.({
      inline: "nearest",
      block: "nearest",
    });
  }, [pestana]);

  /**
   * Un enlace viejo puede apuntar a un contacto ABSORBIDO por una fusión. En
   * vez de un 404 —que es lo que vería quien guardó el enlace hace una semana—
   * se resuelve su canónico y se enseña la ficha buena.
   */
  const canonico = useQuery({
    queryKey: clavesDeFusion.canonico(contactId),
    queryFn: () => getCanonico(contactId),
    retry: false,
  });

  const idEfectivo = canonico.data?.canonicoId ?? contactId;
  const fueFusionado = canonico.data?.fueFusionado ?? false;

  const perfil = useQuery({
    queryKey: clavePerfil(idEfectivo),
    queryFn: () => getPerfilComercial(idEfectivo),
    enabled: Boolean(idEfectivo),
    retry: false,
  });

  const estado =
    (perfil.error as { response?: { status?: number } })?.response?.status ??
    null;

  const rutaDeRegreso = useMemo(
    () => volverA || "/dashboard/contacts",
    [volverA],
  );

  /** Al hilo EXACTO, arrastrando por dónde volver. */
  const enlaceAlChat = (conversationId: string) => {
    const q = new URLSearchParams({ c: conversationId });
    q.set("volverA", `/dashboard/contacts/${idEfectivo}`);
    return `/dashboard/conversations?${q.toString()}`;
  };

  const enlaceAlEmbudo = (pipelineId: string, leadId: string) =>
    `/dashboard/pipeline?embudo=${pipelineId}&lead=${leadId}`;

  if (estado === 403) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <ForbiddenState
          titulo="No puedes ver este contacto"
          detalle="Pertenece a otra empresa o tu rol no lo alcanza."
        />
      </div>
    );
  }

  if (perfil.isError || canonico.isError) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center">
        <p role="alert" className="text-sm font-medium text-neutral-700">
          Ese contacto no está disponible.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Puede haberse eliminado, o el enlace apunta a otra empresa.
        </p>
        <button
          type="button"
          onClick={() => router.push(rutaDeRegreso)}
          className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Volver
        </button>
      </div>
    );
  }

  if (perfil.isLoading || canonico.isLoading) {
    return <p className="p-6 text-sm text-neutral-500">Cargando el perfil…</p>;
  }

  const p = perfil.data;
  if (!p) return null;

  const nombre = p.contacto.nombre || p.contacto.telefono;
  const responsable =
    p.oportunidad?.asesor?.nombre ?? p.conversacion?.asesor?.nombre ?? null;

  const PESTANAS: ReadonlyArray<{
    clave: Pestana;
    etiqueta: string;
    total?: number;
  }> = [
    { clave: "actividad", etiqueta: "Actividad" },
    { clave: "conversaciones", etiqueta: "Conversaciones", total: p.resumen.conversaciones },
    { clave: "oportunidades", etiqueta: "Oportunidades", total: p.resumen.oportunidades },
    { clave: "tareas", etiqueta: "Tareas", total: p.resumen.tareasPendientes },
    { clave: "cotizaciones", etiqueta: "Cotizaciones", total: p.resumen.cotizaciones },
    { clave: "documentos", etiqueta: "Documentos", total: p.resumen.documentos },
  ];

  return (
    <div className="flex w-full flex-col gap-4 p-4 2xl:p-6">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={rutaDeRegreso}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-neutral-600 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Volver
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="truncate text-neutral-500">{nombre}</span>
      </div>

      {fueFusionado && (
        <p
          role="status"
          className="rounded-md border border-status-info/20 bg-status-info-surface px-3 py-2 text-xs text-status-info"
        >
          Este enlace apuntaba a una ficha que se fusionó dentro de otra. Estás
          viendo la ficha que quedó.
        </p>
      )}

      {/* ── Encabezado ───────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar nombre={nombre} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-neutral-900">
              {nombre}
            </h1>
            <p className="mt-0.5 font-mono text-sm text-neutral-600">
              {p.contacto.telefono}
            </p>
            {p.contacto.email && (
              <p className="text-sm text-neutral-500">
                <TextoLargo valor={p.contacto.email} />
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {p.contacto.archivadoEn ? (
                <Badge tone="neutral">Archivado</Badge>
              ) : (
                <Badge tone="success">Activo</Badge>
              )}
              {p.contacto.etiquetas.map((t) => (
                <span
                  key={t}
                  className="max-w-[12rem] truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span>
                Responsable:{" "}
                <span className="text-neutral-800">
                  <TextoLargo valor={responsable ?? "Sin asignar"} />
                </span>
              </span>
              <span>
                Última interacción:{" "}
                <span className="text-neutral-800">
                  {p.ultimaInteraccionEn
                    ? fechaCorta(p.ultimaInteraccionEn)
                    : "Todavía ninguna"}
                </span>
              </span>
            </p>
          </div>
        </div>

        {/* Solo acciones con un flujo real detrás. */}
        <div className="flex flex-wrap gap-2">
          {p.conversacion ? (
            <Link
              href={enlaceAlChat(p.conversacion.id)}
              className="flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white outline-none transition-colors duration-150 hover:bg-primary-900 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <MessageSquare size={14} aria-hidden="true" />
              Abrir conversación
            </Link>
          ) : (
            <span className="rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-400">
              Sin conversación todavía
            </span>
          )}

          {p.oportunidad ? (
            <Link
              href={enlaceAlEmbudo(p.oportunidad.pipeline.id, p.oportunidad.id)}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 outline-none transition-colors duration-150 hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <Target size={14} aria-hidden="true" />
              Ver en pipeline
            </Link>
          ) : (
            <span className="rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-400">
              Sin oportunidad abierta
            </span>
          )}
        </div>
      </header>

      {/* ── Métricas accionables ─────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metrica
          icono={Banknote}
          titulo="Valor abierto"
          valor={moneda(p.resumen.valorAbierto)}
          detalle={`${p.resumen.oportunidades} oportunidad${p.resumen.oportunidades === 1 ? "" : "es"}`}
          onIr={() => setPestana("oportunidades")}
          etiquetaIr="Ver oportunidades"
        />
        <Metrica
          icono={FileText}
          titulo="Cotizaciones"
          valor={String(p.resumen.cotizaciones)}
          detalle={`${p.resumen.documentos} con documento emitido`}
          onIr={() => setPestana("cotizaciones")}
          etiquetaIr="Ver cotizaciones"
        />
        <Metrica
          icono={CheckSquare}
          titulo="Tareas pendientes"
          valor={String(p.resumen.tareasPendientes)}
          detalle={p.resumen.tareasPendientes ? "Por hacer" : "Nada pendiente"}
          onIr={() => setPestana("tareas")}
          etiquetaIr="Ver tareas"
        />
        <Metrica
          icono={MessageSquare}
          titulo="Conversaciones"
          valor={String(p.resumen.conversaciones)}
          detalle={
            p.ultimaInteraccionEn
              ? `Última: ${fechaCorta(p.ultimaInteraccionEn)}`
              : "Sin mensajes"
          }
          onIr={() => setPestana("conversaciones")}
          etiquetaIr="Ver conversaciones"
        />
      </div>

      {/* ── Cuerpo ───────────────────────────────────────────────────
          Tres columnas desde 1440 px. A 1280 la columna central se quedaba en
          unos 550 px y la barra de seis pestañas no cabía: se desplazaba, que
          es justo lo que no debe pasar a ese ancho. Ahí la columna derecha
          BAJA —a lo ancho, con sus tres tarjetas en fila— y el centro respira.
          Mantener tres columnas a cualquier precio es lo que rompía palabras. */}
      <div className="grid gap-4 max-ancho:xl:grid-cols-9 ancho:grid-cols-10">
        {/* Izquierda: quién es */}
        <div className="flex flex-col gap-4 max-ancho:xl:col-span-3 ancho:col-span-2">
          <Tarjeta titulo="Información del contacto">
            <dl className="space-y-1.5 text-sm">
              <Dato etiqueta="Teléfono" valor={p.contacto.telefono} mono />
              <Dato etiqueta="Correo" valor={p.contacto.email ?? "—"} />
              <Dato etiqueta="Empresa" valor={p.empresa.nombre} />
              <Dato
                etiqueta="Creado el"
                valor={fechaLarga(p.contacto.creadoEn)}
              />
              {p.contacto.archivadoEn && (
                <Dato
                  etiqueta="Archivado el"
                  valor={fechaLarga(p.contacto.archivadoEn)}
                />
              )}
            </dl>
          </Tarjeta>

          <Tarjeta titulo="Campos personalizados">
            {p.camposPersonalizados.length > 0 ? (
              <dl className="space-y-1.5 text-sm">
                {p.camposPersonalizados.map((c) => (
                  <Dato key={c.key} etiqueta={c.label} valor={c.valor ?? "—"} />
                ))}
              </dl>
            ) : (
              <Vacio>Sin campos personalizados.</Vacio>
            )}
          </Tarjeta>

          <Tarjeta titulo="Etiquetas">
            {p.contacto.etiquetas.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {p.contacto.etiquetas.map((t) => (
                  <span
                    key={t}
                    className="max-w-full truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <Vacio>Sin etiquetas.</Vacio>
            )}
          </Tarjeta>
        </div>

        {/* Centro: lo relacionado, en pestañas con conteos reales */}
        <div className="min-w-0 xl:col-span-6">
          <div className="rounded-lg border border-neutral-200 bg-white">
            {/* UNA SOLA FILA. Envolviendo, «Documentos 0» caía abajo y la
                barra dejaba de leerse como una barra. Cuando no cabe —1024—
                se desplaza dentro de sí misma, que es lo que se espera de
                unas pestañas, en vez de reordenarse sola. */}
            <div
              role="tablist"
              aria-label="Objetos relacionados"
              className="flex flex-nowrap gap-0.5 overflow-x-auto overflow-y-hidden border-b border-neutral-200 px-1.5 pt-2 [scrollbar-width:thin]"
            >
              {PESTANAS.map((t) => (
                <button
                  key={t.clave}
                  type="button"
                  role="tab"
                  aria-selected={pestana === t.clave}
                  onClick={() => setPestana(t.clave)}
                  ref={pestana === t.clave ? refActiva : undefined}
                  className={`-mb-px flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-1.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-line-focus ${
                    pestana === t.clave
                      ? "border-brand-secondary text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  {t.etiqueta}
                  {t.total !== undefined && (
                    <span className="rounded-full bg-neutral-100 px-1 text-[10px] tabular-nums text-neutral-600">
                      {t.total}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-4">
              {pestana === "actividad" && (
                <LineaDeTiempo actividad={p.actividad} />
              )}

              {pestana === "conversaciones" &&
                (p.conversaciones.length > 0 ? (
                  <ul className="divide-y divide-neutral-100 text-sm">
                    {p.conversaciones.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-neutral-800">
                            {canalLegible(c.canal)}
                            {c.asesor ? ` · ${c.asesor.nombre}` : " · Sin asignar"}
                          </span>
                          <span className="text-xs text-neutral-400">
                            {fechaCorta(c.ultimoMensajeEn)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge tone="neutral">
                            {ESTADO_CONVERSACION[c.estado] ?? c.estado}
                          </Badge>
                          <Link
                            href={enlaceAlChat(c.id)}
                            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                          >
                            Abrir
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Vacio>Todavía no hay conversaciones con esta persona.</Vacio>
                ))}

              {pestana === "oportunidades" &&
                (p.oportunidades.length > 0 ? (
                  <ul className="divide-y divide-neutral-100 text-sm">
                    {p.oportunidades.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="min-w-0 text-neutral-800">
                            <TextoLargo valor={o.titulo} />
                          </span>
                          <span className="text-xs text-neutral-500">
                            {o.pipeline.nombre} · {o.etapa.nombre} ·{" "}
                            <span className="font-mono">{moneda(o.valor)}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge tone="neutral">
                            {ESTADO_OPORTUNIDAD[o.estado] ?? o.estado}
                          </Badge>
                          <Link
                            href={enlaceAlEmbudo(o.pipeline.id, o.id)}
                            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                          >
                            Ver
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Vacio>Sin oportunidades registradas.</Vacio>
                ))}

              {pestana === "tareas" &&
                (p.tareasPendientes.length > 0 ? (
                  <ul className="divide-y divide-neutral-100 text-sm">
                    {p.tareasPendientes.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-start justify-between gap-3 py-2"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="min-w-0 text-neutral-800">
                            <TextoLargo valor={t.titulo} />
                          </span>
                          <span className="text-xs text-neutral-400">
                            Vence: {fechaCorta(t.vence)}
                          </span>
                        </span>
                        <Badge tone="neutral">
                          {PRIORIDAD[t.prioridad] ?? t.prioridad}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Vacio>Nada pendiente.</Vacio>
                ))}

              {pestana === "cotizaciones" &&
                (p.cotizaciones.length > 0 ? (
                  <ul className="divide-y divide-neutral-100 text-sm">
                    {p.cotizaciones.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-neutral-800">
                          <FileText
                            size={13}
                            aria-hidden="true"
                            className="shrink-0 text-neutral-400"
                          />
                          <span className="truncate">{c.numero}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
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
                  <Vacio>Todavía no se ha cotizado nada para esta persona.</Vacio>
                ))}

              {pestana === "documentos" && (
                <>
                  <p className="mb-2 text-xs text-neutral-500">
                    En este producto el documento de un contacto es el PDF de una
                    cotización emitida. Un borrador todavía no lo es.
                  </p>
                  {p.documentos.length > 0 ? (
                    <ul className="divide-y divide-neutral-100 text-sm">
                      {p.documentos.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-neutral-800">
                            <Paperclip
                              size={13}
                              aria-hidden="true"
                              className="shrink-0 text-neutral-400"
                            />
                            <span className="truncate">{d.numero}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-neutral-400">
                              {fechaCorta(d.creadaEn)}
                            </span>
                            <Badge tone="neutral">
                              {ESTADO_COTIZACION[d.estado] ?? d.estado}
                            </Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Vacio>Todavía no se ha emitido ningún documento.</Vacio>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Derecha: qué hacer ahora. A 1280 baja y se pone en fila. */}
        <div className="flex flex-col gap-4 max-ancho:xl:col-span-9 max-ancho:xl:flex-row ancho:col-span-2">
          <Tarjeta titulo="Oportunidad activa">
            {p.oportunidad ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-neutral-900">
                  <TextoLargo valor={p.oportunidad.titulo} />
                </p>
                <dl className="space-y-1.5">
                  <Dato etiqueta="Embudo" valor={p.oportunidad.pipeline.nombre} />
                  <Dato etiqueta="Etapa" valor={p.oportunidad.etapa.nombre} />
                  <Dato
                    etiqueta="Valor"
                    valor={moneda(p.oportunidad.valor)}
                    mono
                  />
                  <Dato
                    etiqueta="Responsable"
                    valor={p.oportunidad.asesor?.nombre ?? "Sin asignar"}
                  />
                </dl>
                <Link
                  href={enlaceAlEmbudo(
                    p.oportunidad.pipeline.id,
                    p.oportunidad.id,
                  )}
                  className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  <Target size={14} aria-hidden="true" />
                  Abrir en pipeline
                </Link>
              </div>
            ) : (
              <Vacio>Sin oportunidad abierta.</Vacio>
            )}
          </Tarjeta>

          <Tarjeta titulo="Próximas acciones">
            {p.tareasPendientes.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {p.tareasPendientes.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-start gap-2">
                    <ListChecks
                      size={14}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-neutral-400"
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-neutral-800">
                        {t.titulo}
                      </span>
                      <span className="text-xs text-neutral-400">
                        {t.vence ? fechaCorta(t.vence) : "Sin fecha"} ·{" "}
                        {PRIORIDAD[t.prioridad] ?? t.prioridad}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Nada pendiente.</Vacio>
            )}
          </Tarjeta>

          <Tarjeta titulo="Contexto de conversación">
            {p.conversacion ? (
              <div className="space-y-2 text-sm">
                <dl className="space-y-1.5">
                  <Dato
                    etiqueta="Estado"
                    valor={
                      ESTADO_CONVERSACION[p.conversacion.estado] ??
                      p.conversacion.estado
                    }
                  />
                  <Dato
                    etiqueta="Asesor"
                    valor={p.conversacion.asesor?.nombre ?? "Sin asignar"}
                  />
                  <Dato
                    etiqueta="Bot"
                    valor={p.conversacion.pausada ? "En pausa" : "Activo"}
                  />
                </dl>
                {p.conversacion.ultimoMensaje && (
                  <p className="break-words rounded-md bg-neutral-50 px-2.5 py-2 text-xs text-neutral-600">
                    {p.conversacion.ultimoMensaje.entrante
                      ? "Escribió: "
                      : "Respondimos: "}
                    {p.conversacion.ultimoMensaje.cuerpo || "(sin texto)"}
                  </p>
                )}
                <Link
                  href={enlaceAlChat(p.conversacion.id)}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-sm text-white outline-none transition-colors duration-150 hover:bg-primary-900 focus-visible:ring-2 focus-visible:ring-line-focus"
                >
                  <MessageSquare size={14} aria-hidden="true" />
                  Ir al chat
                </Link>
              </div>
            ) : (
              <Vacio>Todavía no hay conversación.</Vacio>
            )}
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}

function LineaDeTiempo({
  actividad,
}: {
  actividad: PerfilComercial["actividad"];
}) {
  if (actividad.length === 0) {
    return <Vacio>Sin movimientos todavía.</Vacio>;
  }
  return (
    <ol className="relative space-y-3 border-l border-neutral-200 pl-4 text-sm">
      {actividad.map((a, i) => (
        <li key={`${a.fecha}-${i}`} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-secondary"
          />
          <p className="break-words text-neutral-800">{a.descripcion}</p>
          <p className="text-xs text-neutral-400">{fechaCorta(a.fecha)}</p>
        </li>
      ))}
    </ol>
  );
}

function Metrica({
  icono: Icono,
  titulo,
  valor,
  detalle,
  onIr,
  etiquetaIr,
}: {
  icono: typeof Activity;
  titulo: string;
  valor: string;
  detalle: string;
  onIr: () => void;
  etiquetaIr: string;
}) {
  return (
    <button
      type="button"
      onClick={onIr}
      aria-label={etiquetaIr}
      className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left outline-none transition-colors duration-150 hover:border-neutral-300 hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-brand-primary">
        <Icono size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-neutral-500">{titulo}</span>
        <span className="block truncate font-mono text-base font-semibold text-neutral-900">
          {valor}
        </span>
        <span className="block truncate text-[11px] text-neutral-400">
          {detalle}
        </span>
      </span>
    </button>
  );
}

function Tarjeta({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Dato({
  etiqueta,
  valor,
  mono,
}: {
  etiqueta: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    // SIEMPRE apilado en las columnas laterales: enfrentar etiqueta y valor
    // deja al valor unos 190 px, y ahí «PREVIEW_BRANDING_Muebles del Valle»
    // se parte como «Mueb / les». La etiqueta va arriba, pequeña, y el valor
    // dispone del ancho entero de la tarjeta.
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-neutral-500">{etiqueta}</dt>
      <dd className="min-w-0 text-neutral-900">
        <TextoLargo valor={valor} mono={mono} />
      </dd>
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-400">{children}</p>;
}

/**
 * `use(params)` suspende, así que va DENTRO del límite de Suspense y no fuera:
 * llamarlo en el componente exportado suspende el árbol entero y la página no
 * llega a pintarse nunca. `useSearchParams` necesita el mismo límite.
 */
function ConParametros({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Perfil360 contactId={id} />;
}

export default function Perfil360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ConParametros params={params} />
    </Suspense>
  );
}
