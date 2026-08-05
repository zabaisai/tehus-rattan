"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KanbanSquare, Plus, Settings2 } from "lucide-react";
import { getPipelines } from "@/lib/pipeline";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { LeadFormModal } from "@/components/leads/LeadFormModal";
import { LeadDetailModal } from "@/components/leads/LeadDetailModal";
import { PerfilComercial } from "@/components/perfil/PerfilComercial";
import { useRealtime } from "@/lib/use-realtime";
import { PipelineSelector } from "@/components/kanban/PipelineSelector";
import { ListState } from "@/components/ui/ListState";
import { AdminPipelines } from "@/components/kanban/AdminPipelines";
import { permisosDe } from "@/lib/flowbot-permisos";
import { useAuthStore } from "@/store/auth.store";

/**
 * El estado que importa vive en la URL: qué embudo, qué perfil abierto y qué
 * oportunidad. Con estado local, volver del chat al embudo devolvía al usuario
 * al embudo predeterminado y sin panel, es decir, a empezar de cero.
 */
function PipelineContenido() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Una oportunidad que entra por WhatsApp aparece sola en el tablero.
  useRealtime();
  const {
    data: pipelines,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pipelines"],
    queryFn: getPipelines,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [administrando, setAdministrando] = useState(false);

  const embudoUrl = params.get("embudo");
  const perfilAbierto = params.get("perfil");
  const leadAbierto = params.get("lead");

  // Administrar embudos cambia dónde caen los leads de toda la empresa: es la
  // misma frontera que archivar un bot.
  const puedeAdministrar = permisosDe(
    useAuthStore((s) => s.user?.role),
  ).puedeArchivar;

  /** Reescribe la URL conservando lo demás. Es la memoria de la pantalla. */
  function navegar(cambios: Record<string, string | null>) {
    const siguiente = new URLSearchParams(params.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === null) siguiente.delete(clave);
      else siguiente.set(clave, valor);
    }
    const cadena = siguiente.toString();
    router.replace(cadena ? `${pathname}?${cadena}` : pathname, {
      scroll: false,
    });
  }

  if (isLoading || isError || !pipelines?.length) {
    return (
      <ListState
        isLoading={isLoading}
        isError={isError}
        isEmpty={!pipelines?.length}
        error={error}
        onRetry={() => void refetch()}
        icon={KanbanSquare}
        emptyMessage="No hay pipelines creados todavía."
      />
    );
  }

  const activo =
    pipelines.find((p) => p.id === embudoUrl) ??
    pipelines.find((p) => p.isDefault) ??
    pipelines[0];

  async function refreshKanban() {
    await queryClient.invalidateQueries({ queryKey: ["kanban", activo.id] });
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-neutral-900">
              {activo.name}
            </h2>
            <PipelineSelector
              pipelines={pipelines}
              value={activo.id}
              // Cambiar de embudo cierra el perfil: el que estaba abierto
              // pertenece a otro tablero.
              onChange={(id) =>
                navegar({ embudo: id, perfil: null, lead: null })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            {puedeAdministrar && (
              <button
                onClick={() => setAdministrando(true)}
                className="flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
              >
                <Settings2 size={16} />
                Embudos
              </button>
            )}
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center justify-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm text-white hover:bg-primary-900"
            >
              <Plus size={16} />
              Nuevo lead
            </button>
          </div>
        </div>

        <KanbanBoard
          pipelineId={activo.id}
          // El clic principal abre el PANEL, no un modal: el modal tapa el
          // tablero y obliga a cerrarlo para seguir mirando.
          onLeadClick={(_leadId, contactId) =>
            navegar({ embudo: activo.id, perfil: contactId })
          }
        />
      </div>

      {perfilAbierto && (
        <PerfilComercial
          key={perfilAbierto}
          contactId={perfilAbierto}
          origen="pipeline"
          onCerrar={() => navegar({ perfil: null })}
        />
      )}

      {createOpen && (
        <LeadFormModal
          pipelineId={activo.id}
          stages={activo.stages}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            await refreshKanban();
            setCreateOpen(false);
          }}
        />
      )}

      {administrando && (
        <AdminPipelines onCerrar={() => setAdministrando(false)} />
      )}

      {leadAbierto && (
        <LeadDetailModal
          leadId={leadAbierto}
          stages={activo.stages}
          onClose={() => navegar({ lead: null })}
          onChanged={refreshKanban}
        />
      )}
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
