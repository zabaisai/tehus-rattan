'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KanbanSquare, Plus } from 'lucide-react';
import { getPipelines } from '@/lib/pipeline';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { LeadFormModal } from '@/components/leads/LeadFormModal';
import { LeadDetailModal } from '@/components/leads/LeadDetailModal';
import { useRealtime } from '@/lib/use-realtime';
import { PipelineSelector } from '@/components/kanban/PipelineSelector';
import { ListState } from '@/components/ui/ListState';

export default function PipelinePage() {
  const queryClient = useQueryClient();
  // Una oportunidad que entra por WhatsApp aparece sola en el tablero.
  useRealtime();
  const { data: pipelines, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // `null` significa "aun no ha elegido": se resuelve al predeterminado. Fijar
  // el id en cuanto cargan los pipelines obligaria a un efecto y a un
  // renderizado extra sin ganar nada.
  const [pipelineElegido, setPipelineElegido] = useState<string | null>(null);

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
    pipelines.find((p) => p.id === pipelineElegido) ??
    pipelines.find((p) => p.isDefault) ??
    pipelines[0];

  async function refreshKanban() {
    await queryClient.invalidateQueries({ queryKey: ['kanban', activo.id] });
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-neutral-900">{activo.name}</h2>
          <PipelineSelector
            pipelines={pipelines}
            value={activo.id}
            onChange={setPipelineElegido}
          />
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm text-white hover:bg-primary-900"
        >
          <Plus size={16} />
          Nuevo lead
        </button>
      </div>
      <KanbanBoard pipelineId={activo.id} onLeadClick={setSelectedLeadId} />

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

      {selectedLeadId && (
        <LeadDetailModal
          leadId={selectedLeadId}
          stages={activo.stages}
          onClose={() => setSelectedLeadId(null)}
          onChanged={refreshKanban}
        />
      )}
    </div>
  );
}