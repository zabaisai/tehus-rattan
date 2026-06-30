import { Draggable } from '@hello-pangea/dnd';
import { Lead } from '@/types';

function formatCurrency(value: number | null) {
  if (!value) return null;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

export function LeadCard({ lead, index }: { lead: Lead; index: number }) {
  return (
    <Draggable draggableId={lead.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`mb-2 rounded-md border border-stone-200 bg-white p-3 shadow-sm transition-shadow ${
            snapshot.isDragging ? 'shadow-md ring-1 ring-stone-300' : ''
          }`}
        >
          <p className="text-sm font-medium text-stone-900">{lead.title}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            {lead.contact.name || lead.contact.phone}
          </p>
          <div className="mt-2 flex items-center justify-between">
            {formatCurrency(lead.value) && (
              <span className="text-xs font-medium text-stone-700">
                {formatCurrency(lead.value)}
              </span>
            )}
            {lead.agent && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
                {lead.agent.name}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}