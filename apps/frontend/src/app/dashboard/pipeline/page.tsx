'use client';

import { useQuery } from '@tanstack/react-query';
import { getPipelines } from '@/lib/pipeline';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';

export default function PipelinePage() {
  const { data: pipelines, isLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
  });

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

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-stone-900">
        {defaultPipeline.name}
      </h2>
      <KanbanBoard pipelineId={defaultPipeline.id} />
    </div>
  );
}