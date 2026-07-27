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

export function LeadCard({
  lead,
  index,
  onOpen,
  stages,
  onMoveStage,
}: {
  lead: Lead;
  index: number;
  onOpen: (leadId: string) => void;
  stages: { id: string; name: string }[];
  onMoveStage: (leadId: string, newStageId: string) => void;
}) {
  return (
    <Draggable draggableId={lead.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onOpen(lead.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onOpen(lead.id);
          }}
          className={`mb-2 cursor-pointer rounded-md border border-stone-200 bg-white p-3 shadow-sm transition-shadow hover:border-stone-300 ${
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

          {/* Mobile/tablet: dragging a card is impractical on touch, so this
              select is the primary way to change stage below lg. Stopping
              propagation keeps @hello-pangea/dnd's drag-handle listeners
              (bound to this whole card) from swallowing the tap. */}
          <div
            className="mt-2 lg:hidden"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <label className="sr-only" htmlFor={`move-stage-${lead.id}`}>
              Mover a etapa
            </label>
            <select
              id={`move-stage-${lead.id}`}
              value={lead.stageId}
              onChange={(e) => onMoveStage(lead.id, e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === lead.stageId ? '● ' : ''}
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Draggable>
  );
}