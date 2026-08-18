"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Coins,
  KanbanSquare,
  Percent,
  Plus,
  Search,
  Settings2,
  Target,
  UsersRound,
} from "lucide-react";
import { getPipelines, getKanban } from "@/lib/pipeline";
import { getOverview } from "@/lib/analytics";
import { TableroVertical } from "@/components/kanban/TableroVertical";
import { LeadFormModal } from "@/components/leads/LeadFormModal";
import { LeadDetailModal } from "@/components/leads/LeadDetailModal";
import { PerfilComercial } from "@/components/perfil/PerfilComercial";
import { AdminPipelines } from "@/components/kanban/AdminPipelines";
import { PipelineSelector } from "@/components/kanban/PipelineSelector";
import { Button } from "@/components/ui/Button";
import { ListState } from "@/components/ui/ListState";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRealtime } from "@/lib/use-realtime";
import { permisosDe } from "@/lib/flowbot-permisos";
import { useAuthStore } from "@/store/auth.store";
import {
  aplicarEnPipeline,
  asesoresDelEmbudo,
  filtrarEtapas,
  leerEstadoDePipeline,
  moneda,
  resumenDelEmbudo,
  rutaDePipeline,
  type CambiosDePipeline,
} from "@/lib/pipeline-url";
import type { KanbanData, Lead } from "@/types";

const RETARDO_DE_BUSQUEDA = 300;

/**
 * Pipeline de ventas — incremento 4.1, mockup 04.
 *
 * TODO LO QUE SE ESTÁ MIRANDO VIVE EN LA URL: embudo, tarjeta seleccionada,
 * ficha abierta, detalle, búsqueda, responsable y etapas plegadas. Antes solo
 * viajaban tres de esas cosas y, además, se escribían con `router.replace`,
 * que en el build de producción no llega a aplicarse cuando la ruta no cambia
 * —la misma trampa que ya costó una ronda de revisión en la bandeja (3.y) y
 * otra en Contactos (3.z)—. Aquí se escribe con la History API, que Next sí
 * observa.
 */
function PipelineContenido() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const parametros = useSearchParams();
  const estado = leerEstadoDePipeline(
    new URLSearchParams(parametros.toString()),
  );

  // Una oportunidad que entra por WhatsApp aparece sola en el tablero.
  useRealtime();

  const embudos = useQuery({ queryKey: ["pipelines"], queryFn: getPipelines });

  const navegar = useCallback(
    (cambios: CambiosDePipeline, modo: "push" | "replace" = "push") => {
      if (typeof window === "undefined") return;
      const q = aplicarEnPipeline(
        new URLSearchParams(window.location.search),
        cambios,
      );
      const url = q ? `${pathname}?${q}` : pathname;
      // `push` para lo que es ir a otro sitio —abrir una ficha, cambiar de
      // embudo—; `replace` para teclear en el buscador, donde una entrada de
      // historial por pulsación deja el botón Atrás inservible.
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );

  const [creandoEn, setCreandoEn] = useState<string | null>(null);
  const [administrando, setAdministrando] = useState(false);

  // Administrar embudos y etapas cambia dónde caen las oportunidades de toda
  // la empresa: es la misma frontera que archivar un bot, y el servidor la
  // reserva a ADMIN. Aquí solo se decide qué se DIBUJA.
  const rol = useAuthStore((s) => s.user?.role);
  const puedeAdministrar = permisosDe(rol).puedeArchivar;

  const activo =
    embudos.data?.find((p) => p.id === estado.embudo) ??
    embudos.data?.find((p) => p.isDefault) ??
    embudos.data?.[0];

  // MISMA ENTRADA DE CACHÉ QUE EL TABLERO. La cabecera necesita las cifras del
  // embudo y el tablero las tarjetas; con dos consultas distintas acabarían
  // discrepando. Con la misma clave, react-query sirve una sola respuesta.
  const kanban = useQuery({
    queryKey: ["kanban", activo?.id],
    queryFn: () => getKanban(activo!.id),
    enabled: !!activo,
  });

  // La conversión global es de la EMPRESA, no de este embudo: sale del mismo
  // contrato que ya usa el Inicio, y por eso lleva su alcance escrito al lado.
  const general = useQuery({
    // MISMA CLAVE QUE EL INICIO: la conversión ya se pide allí, así que aquí
    // no hay una segunda petición, y las dos pantallas no pueden discrepar.
    queryKey: ["analytics-overview"],
    queryFn: getOverview,
  });

  const cerradas = general.data
    ? general.data.wonCount + general.data.lostCount
    : null;

  const [textoBusqueda, setTextoBusqueda] = useState(estado.q);
  const [busquedaAplicada, setBusquedaAplicada] = useState(estado.q);
  if (estado.q !== busquedaAplicada) {
    setBusquedaAplicada(estado.q);
    setTextoBusqueda(estado.q);
  }

  useEffect(() => {
    if (textoBusqueda.trim() === estado.q) return;
    const t = setTimeout(
      () => navegar({ q: textoBusqueda }, "replace"),
      RETARDO_DE_BUSQUEDA,
    );
    return () => clearTimeout(t);
  }, [textoBusqueda, estado.q, navegar]);

  const estadoHttp = (embudos.error as { response?: { status?: number } })
    ?.response?.status;

  if (estadoHttp === 403) {
    return (
      <ForbiddenState
        titulo="No tienes permiso para ver el embudo"
        detalle="El tablero de oportunidades lo ven los roles con acceso comercial. Pídeselo a un administrador de tu empresa."
      />
    );
  }

  if (embudos.isLoading || embudos.isError || !activo) {
    return (
      <ListState
        isLoading={embudos.isLoading}
        isError={embudos.isError}
        isEmpty={!activo}
        error={embudos.error}
        onRetry={() => void embudos.refetch()}
        icon={KanbanSquare}
        emptyMessage="No hay embudos creados todavía."
        emptyAction={
          puedeAdministrar ? (
            <Button
              variant="accent"
              size="sm"
              onClick={() => setAdministrando(true)}
            >
              <Plus size={14} aria-hidden="true" />
              Crear el primer embudo
            </Button>
          ) : undefined
        }
      />
    );
  }

  const etapasDelEmbudo = [...activo.stages].sort((a, b) => a.order - b.order);
  const datos = kanban.data as KanbanData | undefined;
  const filtro = { q: estado.q, asesor: estado.asesor };
  const hayFiltro = !!estado.q || !!estado.asesor;
  // EL RESUMEN CUENTA LO QUE SE ESTÁ VIENDO. Con el filtro puesto, las
  // cabeceras de etapa ya se recalculaban y estas cuatro cifras no: el tablero
  // enseñaba una oportunidad y arriba seguía diciendo once. Es exactamente la
  // discrepancia que hace que nadie se fíe del número.
  const resumen = resumenDelEmbudo(filtrarEtapas(datos?.stages ?? [], filtro));
  const totalSinFiltro = resumenDelEmbudo(datos?.stages ?? []).oportunidades;
  // El desplegable de responsables se arma con el tablero SIN filtrar: si se
  // armara con el filtrado, elegir a alguien vaciaría la lista y ya no habría
  // forma de volver a otro sin quitar el filtro.
  const asesores = asesoresDelEmbudo(datos?.stages ?? []);
  const cargandoCifras = kanban.isLoading;
  const rutaActual = rutaDePipeline(parametros.toString());

  /** Plegar y desplegar. La URL guarda las CERRADAS: sin parámetro, todo abierto. */
  function plegar(etapaId: string, plegada: boolean) {
    const siguientes = plegada
      ? [...estado.plegadas, etapaId]
      : estado.plegadas.filter((id) => id !== etapaId);
    navegar({ plegadas: siguientes }, "replace");
  }

  function seleccionar(lead: Lead) {
    // Seleccionar abre la ficha lateral y NO saca al usuario del tablero: el
    // §4.3 pide detalle contextual, no una pantalla nueva.
    navegar({ seleccion: lead.id, perfil: lead.contact.id });
  }

  const todasPlegadas =
    etapasDelEmbudo.length > 0 &&
    etapasDelEmbudo.every((e) => estado.plegadas.includes(e.id));

  return (
    // `min-w-0` en la columna del tablero es lo que mantiene el desplazamiento
    // horizontal DENTRO de cada etapa. Sin él, una fila de doce tarjetas
    // ensancha la columna, luego el flex, luego el documento, y la pantalla
    // acaba con una segunda barra horizontal.
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* ── Cabecera ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-content-primary">
              Pipeline de ventas
            </h2>
            <p className="mt-0.5 text-sm text-content-secondary">
              Las oportunidades abiertas, etapa por etapa
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {embudos.data && embudos.data.length > 1 ? (
              <PipelineSelector
                pipelines={embudos.data}
                value={activo.id}
                onChange={(id) => navegar({ embudo: id })}
              />
            ) : (
              // Con un solo embudo no se dibuja un desplegable de una opción
              // —decisión ya tomada y probada—, pero su nombre sí se enseña:
              // el mockup lo pone junto al título y es lo que da contexto.
              <span className="rounded-md border border-line-default bg-surface-default px-2.5 py-1.5 text-sm text-content-primary">
                {activo.name}
                {activo.isDefault && (
                  <span className="text-content-secondary">
                    {" · Predeterminado"}
                  </span>
                )}
              </span>
            )}

            {puedeAdministrar && (
              <Button variant="secondary" onClick={() => setAdministrando(true)}>
                <Settings2 size={16} aria-hidden="true" />
                Configurar etapas
              </Button>
            )}

            <Button variant="accent" onClick={() => setCreandoEn("")}>
              <Plus size={16} aria-hidden="true" />
              Nueva oportunidad
            </Button>
          </div>
        </div>

        {/* ── Cifras del embudo ──────────────────────────────────── */}
        {/* No usan `MetricCard`: esa pieza es, por diseño, una métrica que
            LLEVA a su listado —`href` obligatorio—, y estas cuatro describen
            el tablero que ya se está mirando. Inventarles un destino para
            poder reutilizar el componente sería peor que no reutilizarlo. */}
        {/* Las columnas dependen de si el panel está abierto, no solo del
            ancho de la ventana. A 1440 px con la ficha abierta, cuatro
            columnas dejan ~130 px por cifra y «$ 77.480.000» se partía en dos
            líneas por la mitad del número. */}
        <dl
          className={`grid gap-3 ${
            estado.perfil ? "grid-cols-2 2xl:grid-cols-4" : "grid-cols-2 xl:grid-cols-4"
          }`}
        >
          <Cifra
            icono={Target}
            etiqueta="oportunidades abiertas"
            valor={String(resumen.oportunidades)}
            cargando={cargandoCifras}
          />
          <Cifra
            icono={Coins}
            etiqueta="en curso"
            valor={moneda(resumen.valor)}
            cargando={cargandoCifras}
          />
          <Cifra
            icono={Percent}
            etiqueta="conversión de la empresa"
            // SIN NADA CERRADO NO HAY CONVERSIÓN, Y «0 %» NO ES CERO: es que
            // todavía no se ha ganado ni perdido ninguna. El contrato devuelve
            // 0 en ese caso, así que aquí se distingue con `wonCount` y
            // `lostCount` en vez de afirmar un fracaso que no ha ocurrido.
            valor={
              general.data
                ? cerradas === 0
                  ? "—"
                  : `${general.data.conversionRate} %`.replace(".", ",")
                : "—"
            }
            cargando={general.isLoading}
            nota={
              general.data && cerradas === 0
                ? "todavía no hay oportunidades ganadas ni perdidas"
                : "ganadas frente a cerradas, todos los embudos"
            }
          />
          <Cifra
            icono={AlertTriangle}
            etiqueta="sin responsable"
            valor={String(resumen.sinResponsable)}
            cargando={cargandoCifras}
            tono={resumen.sinResponsable > 0 ? "atencion" : "neutral"}
          />
        </dl>

        {/* ── Filtros ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-disabled"
            />
            <input
              type="search"
              value={textoBusqueda}
              onChange={(e) => setTextoBusqueda(e.target.value)}
              aria-label="Buscar oportunidades"
              placeholder="Buscar oportunidades…"
              className="w-full rounded-md border border-line-default bg-surface-default py-2 pl-8 pr-2.5 text-sm text-content-primary outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
          </div>

          <label className="flex items-center gap-1.5 text-sm text-content-secondary">
            <UsersRound size={15} aria-hidden="true" />
            <span className="sr-only">Filtrar por responsable</span>
            <select
              value={estado.asesor ?? ""}
              onChange={(e) => navegar({ asesor: e.target.value || null })}
              aria-label="Filtrar por responsable"
              className="rounded-md border border-line-default bg-surface-default px-2 py-2 text-sm text-content-primary outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <option value="">Todos los responsables</option>
              <option value="sin">Sin responsable</option>
              {asesores.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </label>

          <Button
            variant="quiet"
            onClick={() =>
              navegar(
                {
                  plegadas: todasPlegadas
                    ? []
                    : etapasDelEmbudo.map((e) => e.id),
                },
                "replace",
              )
            }
          >
            {todasPlegadas ? "Desplegar todas" : "Plegar todas"}
          </Button>

          {/* Con filtro, las cifras de arriba cuentan lo FILTRADO. Decirlo
              evita la lectura contraria —«el embudo se ha quedado en una»— y
              da la salida en el mismo sitio. */}
          {hayFiltro && (
            <p className="flex items-center gap-2 text-xs text-content-secondary">
              <span>
                Mostrando {resumen.oportunidades} de {totalSinFiltro}{" "}
                oportunidades
              </span>
              <button
                type="button"
                onClick={() => navegar({ q: "", asesor: null })}
                className="font-medium text-brand-primary underline outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
              >
                Quitar filtros
              </button>
            </p>
          )}
        </div>

        <TableroVertical
          embudo={activo}
          filtro={filtro}
          seleccion={estado.seleccion}
          plegadas={estado.plegadas}
          puedeAdministrar={puedeAdministrar}
          onPlegar={plegar}
          onSeleccionar={seleccionar}
          onAbrirOportunidad={(lead) =>
            navegar({ lead: lead.id, seleccion: lead.id })
          }
          onAgregar={(etapaId) => setCreandoEn(etapaId)}
        />
      </div>

      {estado.perfil && (
        <PerfilComercial
          key={estado.perfil}
          contactId={estado.perfil}
          origen="pipeline"
          // La ficha enseña LA oportunidad de la tarjeta que se pulsó, no la
          // más reciente del contacto. Con dos oportunidades abiertas, ver la
          // otra al abrir la ficha es peor que no abrirla.
          oportunidadPreferidaId={estado.seleccion}
          rutaDeRegreso={rutaActual}
          onCerrar={() => navegar({ perfil: null, seleccion: null })}
        />
      )}

      {creandoEn !== null && (
        <LeadFormModal
          pipelineId={activo.id}
          stages={etapasDelEmbudo}
          etapaInicialId={creandoEn || undefined}
          onClose={() => setCreandoEn(null)}
          onCreated={async () => {
            await queryClient.invalidateQueries({
              queryKey: ["kanban", activo.id],
            });
            setCreandoEn(null);
          }}
        />
      )}

      {administrando && (
        <AdminPipelines onCerrar={() => setAdministrando(false)} />
      )}

      {estado.lead && (
        <LeadDetailModal
          leadId={estado.lead}
          stages={etapasDelEmbudo}
          onClose={() => navegar({ lead: null })}
          onChanged={async () => {
            await queryClient.invalidateQueries({
              queryKey: ["kanban", activo.id],
            });
            await queryClient.invalidateQueries({ queryKey: ["perfil"] });
          }}
        />
      )}
    </div>
  );
}

/** Una cifra del embudo. Describe lo que ya se ve; no lleva a otro sitio. */
function Cifra({
  icono: Icono,
  etiqueta,
  valor,
  cargando,
  tono = "neutral",
  nota,
}: {
  icono: typeof Target;
  etiqueta: string;
  valor: string;
  cargando: boolean;
  tono?: "neutral" | "atencion";
  nota?: string;
}) {
  const acento =
    tono === "atencion"
      ? "bg-status-warning-surface text-status-warning-strong"
      : "bg-primary-50 text-brand-primary";

  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-line-default bg-surface-default p-3 shadow-xs">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${acento}`}
      >
        <Icono size={17} />
      </span>
      <div className="min-w-0">
        {cargando ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          /* `whitespace-nowrap`: una cifra partida en dos líneas deja de
             leerse como una cifra. Si no cupiera, el problema es el número de
             columnas, y eso se resuelve arriba. */
          <dd className="whitespace-nowrap font-mono text-xl font-semibold leading-tight tabular-nums text-content-primary">
            {valor}
          </dd>
        )}
        <dt className="mt-0.5 break-words text-xs text-content-secondary">
          {etiqueta}
        </dt>
        {nota && (
          <p className="mt-0.5 break-words text-[11px] text-content-disabled">
            {nota}
          </p>
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  // `useSearchParams` obliga a un límite de Suspense para que la página pueda
  // prerenderizarse; sin él, el build falla al generarla.
  return (
    <Suspense fallback={null}>
      <PipelineContenido />
    </Suspense>
  );
}
