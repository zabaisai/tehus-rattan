import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { LeadCard } from './LeadCard';
import { Lead } from '@/types';

const lead: Lead = {
  id: 'lead-1',
  title: 'Sala Primavera',
  value: 1200000,
  status: 'OPEN',
  lostReason: null,
  expectedCloseDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  contactId: 'contact-1',
  contact: { id: 'contact-1', name: 'Cliente Uno', phone: '+573000000000' },
  pipelineId: 'pipeline-1',
  stageId: 'stage-1',
  assignedTo: null,
  agent: null,
};

const stages = [
  { id: 'stage-1', name: 'Nuevo lead' },
  { id: 'stage-2', name: 'Contactado' },
];

// LeadCard is a @hello-pangea/dnd Draggable — it needs a DragDropContext +
// Droppable ancestor to mount at all, mirroring how KanbanColumn renders it.
function renderInBoard(ui: React.ReactElement) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="stage-1">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            {ui}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
}

describe('LeadCard — mobile "mover a etapa" (non-drag-and-drop path)', () => {
  it('calls onMoveStage with the new stage id when the select changes, without opening the card', () => {
    const onOpen = vi.fn();
    const onMoveStage = vi.fn();

    renderInBoard(
      <LeadCard lead={lead} index={0} onOpen={onOpen} stages={stages} onMoveStage={onMoveStage} />,
    );

    const select = screen.getByLabelText('Mover a etapa');
    fireEvent.change(select, { target: { value: 'stage-2' } });

    expect(onMoveStage).toHaveBeenCalledWith('lead-1', 'stage-2');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('still opens the lead detail when the card body itself is clicked', () => {
    const onOpen = vi.fn();
    renderInBoard(
      <LeadCard lead={lead} index={0} onOpen={onOpen} stages={stages} onMoveStage={vi.fn()} />,
    );

    fireEvent.click(screen.getByText('Sala Primavera'));
    expect(onOpen).toHaveBeenCalledWith('lead-1');
  });

  it('lists every pipeline stage as an option', () => {
    renderInBoard(
      <LeadCard lead={lead} index={0} onOpen={vi.fn()} stages={stages} onMoveStage={vi.fn()} />,
    );

    expect(screen.getByRole('option', { name: /Nuevo lead/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Contactado' })).toBeInTheDocument();
  });
});
