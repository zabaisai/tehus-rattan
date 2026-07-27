'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getPipelines } from '@/lib/pipeline';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { LeadFormModal } from '@/components/leads/LeadFormModal';
import { LeadDetailModal } from '@/components/leads/LeadDetailModal';

export default function PipelinePage() {
  const queryClient = useQueryClient();
  const { data: pipelines, isLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-sm text-stone-500">Cargando...</p>;
  }

  if (!pipelines || pipelines.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        No hay pipelines creados todavía.
      </p>
    );
  }

  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  async function refreshKanban() {
    await queryClient.invalidateQueries({ queryKey: ['kanban', defaultPipeline.id] });
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-stone-900">
          {defaultPipeline.name}
        </h2>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800"
        >
          <Plus size={16} />
          Nuevo lead
        </button>
      </div>
      <KanbanBoard pipelineId={defaultPipeline.id} onLeadClick={setSelectedLeadId} />

      {createOpen && (
        <LeadFormModal
          pipelineId={defaultPipeline.id}
          stages={defaultPipeline.stages}
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
          stages={defaultPipeline.stages}
          onClose={() => setSelectedLeadId(null)}
          onChanged={refreshKanban}
        />
      )}
    </div>
  );
}