"use client";

import { Suspense, use, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Target,
  UserRound,
} from "lucide-react";
import { getPerfilComercial, clavePerfil } from "@/lib/perfil";
import { getCanonico, clavesDeFusion } from "@/lib/fusion";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { ForbiddenState } from "@/components/ui/ForbiddenState";

/**
 * Perfil 360 de un contacto (mockup 18).
 *
 * Existe para que «Ver perfil completo» del inbox lleve a algún sitio: antes no
 * había ruta de contacto y el enlace no se podía ofrecer. NO duplica consultas
 * ni contratos: pide el MISMO `/contacts/:id/perfil` que la ficha lateral y
 * comparte con ella la entrada de caché, así que las dos pantallas no pueden
 * discrepar sobre la misma persona.
 *
 * Lo que enseña es lo que el contrato trae. No hay «calidad del dato», ni
 * «última compra», ni «relación activa 82 %» del mockup: esas cifras no existen
 * en el producto y ponerlas obligaría a inventarlas.
 */

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

function Perfil360({ contactId }: { contactId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const volverA = params.get("volverA");

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
    return (
      <p className="p-6 text-sm text-neutral-500">Cargando el perfil…</p>
    );
  }

  const p = perfil.data;
  if (!p) return null;

  const nombre = p.contacto.nombre || p.contacto.telefono;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 xl:p-6">
      {/* Volver: la ruta viene de quien nos mandó, así que regresar cae en el
          MISMO hilo con sus filtros, no en la bandeja de cero. */}
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

      {/* Encabezado */}
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
              <p className="truncate text-sm text-neutral-500">
                {p.contacto.email}
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
                  className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

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
              href={`/dashboard/pipeline?embudo=${p.oportunidad.pipeline.id}&lead=${p.oportunidad.id}`}
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

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Columna de datos */}
        <div className="flex flex-col gap-4">
          <Panel titulo="Información del contacto">
            <dl className="space-y-1.5 text-sm">
              <Dato etiqueta="Teléfono" valor={p.contacto.telefono} mono />
              <Dato etiqueta="Correo" valor={p.contacto.email ?? "—"} />
              <Dato etiqueta="Empresa" valor={p.empresa.nombre} />
              <Dato
                etiqueta="Creado el"
                valor={fechaLarga(p.contacto.creadoEn)}
              />
            </dl>
          </Panel>

          {p.camposPersonalizados.length > 0 && (
            <Panel titulo="Campos personalizados">
              <dl className="space-y-1.5 text-sm">
                {p.camposPersonalizados.map((c) => (
                  <Dato
                    key={c.key}
                    etiqueta={c.label}
                    valor={c.valor ?? "—"}
                  />
                ))}
              </dl>
            </Panel>
          )}
        </div>

        {/* Columna central: lo relacionado */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel titulo={`Cotizaciones (${p.cotizaciones.length})`}>
            {p.cotizaciones.length > 0 ? (
              <ul className="divide-y divide-neutral-100 text-sm">
                {p.cotizaciones.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 py-1.5"
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
            )}
          </Panel>

          <Panel titulo={`Tareas pendientes (${p.tareasPendientes.length})`}>
            {p.tareasPendientes.length > 0 ? (
              <ul className="divide-y divide-neutral-100 text-sm">
                {p.tareasPendientes.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-2 py-1.5"
                  >
                    <span className="min-w-0 break-words text-neutral-800">
                      {t.titulo}
                    </span>
                    <Badge tone="neutral">
                      {PRIORIDAD[t.prioridad] ?? t.prioridad}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Nada pendiente.</Vacio>
            )}
          </Panel>

          <Panel titulo="Actividad reciente">
            {p.actividad.length > 0 ? (
              <ul className="divide-y divide-neutral-100 text-sm">
                {p.actividad.map((a, i) => (
                  <li
                    key={`${a.fecha}-${i}`}
                    className="flex justify-between gap-3 py-1.5"
                  >
                    <span className="min-w-0 break-words text-neutral-700">
                      {a.descripcion}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {fechaLarga(a.fecha)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Vacio>Sin movimientos todavía.</Vacio>
            )}
          </Panel>
        </div>
      </div>
    </div>
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
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-neutral-500">{etiqueta}</dt>
      <dd
        className={`min-w-0 break-words text-right text-neutral-900 ${
          mono ? "font-mono" : ""
        }`}
      >
        {valor}
      </dd>
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-neutral-400">
      <UserRound size={14} aria-hidden="true" />
      {children}
    </p>
  );
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
