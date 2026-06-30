import { Droppable } from '@hello-pangea/dnd';
import { KanbanStage } from '@/types';
import { LeadCard } from './LeadCard';

function formatCurrency(value: number) {
  if (!value) return null;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

export function KanbanColumn({ stage }: { stage: KanbanStage }) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-stone-100">
      <div className="border-b border-stone-200 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800">{stage.name}</h3>
          <span className="text-xs text-stone-500">{stage.leadCount}</span>
        </div>
        {formatCurrency(stage.totalValue) && (
          <p className="mt-0.5 text-xs text-stone-500">
            {formatCurrency(stage.totalValue)}
          </p>
        )}
      </div>

      <Droppable droppableId={stage.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 overflow-y-auto p-2 transition-colors ${
              snapshot.isDraggingOver ? 'bg-stone-200/60' : ''
            }`}
            style={{ minHeight: 80 }}
          >
            {stage.leads.map((lead, index) => (
              <LeadCard key={lead.id} lead={lead} index={index} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}