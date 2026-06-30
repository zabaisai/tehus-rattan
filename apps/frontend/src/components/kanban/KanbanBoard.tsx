'use client';

import { useState } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getKanban, changeLeadStage } from '@/lib/pipeline';
import { KanbanData } from '@/types';
import { KanbanColumn } from './KanbanColumn';

export function KanbanBoard({ pipelineId }: { pipelineId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['kanban', pipelineId];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => getKanban(pipelineId),
  });

  const [error, setError] = useState('');

  async function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const previous = queryClient.getQueryData<KanbanData>(queryKey);
    if (!previous) return;

    // Actualización optimista: mover la tarjeta visualmente antes de la respuesta del servidor
    const next: KanbanData = structuredClone(previous);
    const sourceStage = next.stages.find((s) => s.id === source.droppableId);
    const destStage = next.stages.find((s) => s.id === destination.droppableId);
    if (!sourceStage || !destStage) return;

    const [movedLead] = sourceStage.leads.splice(source.index, 1);
    destStage.leads.splice(destination.index, 0, movedLead);

    sourceStage.leadCount = sourceStage.leads.length;
    destStage.leadCount = destStage.leads.length;
    sourceStage.totalValue = sourceStage.leads.reduce((sum, l) => sum + (l.value || 0), 0);
    destStage.totalValue = destStage.leads.reduce((sum, l) => sum + (l.value || 0), 0);

    queryClient.setQueryData(queryKey, next);
    setError('');

    try {
      await changeLeadStage(draggableId, destination.droppableId);
    } catch {
      // Si falla, revertir al estado anterior del servidor
      queryClient.setQueryData(queryKey, previous);
      setError('No se pudo mover el lead. Intenta de nuevo.');
    }
  }

  if (isLoading) {
    return <p className="text-sm text-stone-500">Cargando pipeline...</p>;
  }

  if (isError || !data) {
    return <p className="text-sm text-red-600">No se pudo cargar el pipeline.</p>;
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {data.stages.map((stage) => (
            <KanbanColumn key={stage.id} stage={stage} />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}