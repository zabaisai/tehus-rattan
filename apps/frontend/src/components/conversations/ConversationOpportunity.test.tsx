import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationOpportunity } from './ConversationOpportunity';
import type { Conversation } from '@/types';

const createTask = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tasks', () => ({ createTask }));

const base = {
  id: 'conv-1',
  status: 'OPEN',
  stage: null,
  isPaused: false,
  channel: 'whatsapp',
  lastMessageAt: null,
  updatedAt: '2026-07-31T00:00:00Z',
  contact: { id: 'contact-1', name: 'Ana', phone: '+573001112233' },
  agent: null,
} as unknown as Conversation;

const conLead = {
  ...base,
  lead: {
    id: 'lead-1',
    title: 'Oportunidad — Ana',
    status: 'OPEN' as const,
    stage: { id: 'stage-1', name: 'Nuevo', color: '#10b981' },
  },
} as Conversation;

describe('ConversationOpportunity', () => {
  beforeEach(() => {
    createTask.mockReset();
    createTask.mockResolvedValue({ id: 'task-1' });
  });

  describe('estado comercial visible desde el chat', () => {
    it('muestra la oportunidad y su etapa', () => {
      render(<ConversationOpportunity conversation={conLead} />);

      expect(screen.getByText('Oportunidad — Ana')).toBeInTheDocument();
      expect(screen.getByText('Nuevo')).toBeInTheDocument();
    });

    it('sin oportunidad lo dice como estado normal, no como error', () => {
      // No toda conversación es una venta: soporte, consultas, spam.
      render(<ConversationOpportunity conversation={base} />);

      expect(screen.getByText('Sin oportunidad asociada')).toBeInTheDocument();
    });
  });

  describe('tarea sin salir de la conversación', () => {
    it('crea la tarea atada a la conversación, la oportunidad y el contacto', async () => {
      // Atarla a las tres cosas es lo que hace que después aparezca tanto en
      // el tablero como en la ficha del cliente, que es donde se la busca.
      const user = userEvent.setup();
      render(<ConversationOpportunity conversation={conLead} />);

      await user.click(screen.getByRole('button', { name: /nueva tarea/i }));
      await user.type(screen.getByLabelText(/título de la tarea/i), 'Llamar mañana');
      await user.click(screen.getByRole('button', { name: /^crear$/i }));

      await waitFor(() =>
        expect(createTask).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Llamar mañana',
            conversationId: 'conv-1',
            leadId: 'lead-1',
            contactId: 'contact-1',
          }),
        ),
      );
    });

    it('sin oportunidad la tarea se crea igual, solo con la conversación', async () => {
      const user = userEvent.setup();
      render(<ConversationOpportunity conversation={base} />);

      await user.click(screen.getByRole('button', { name: /nueva tarea/i }));
      await user.type(screen.getByLabelText(/título de la tarea/i), 'Revisar');
      await user.click(screen.getByRole('button', { name: /^crear$/i }));

      await waitFor(() => expect(createTask).toHaveBeenCalled());
      expect(createTask.mock.calls[0][0].leadId).toBeUndefined();
    });

    it('no envía una tarea sin título', async () => {
      const user = userEvent.setup();
      render(<ConversationOpportunity conversation={conLead} />);

      await user.click(screen.getByRole('button', { name: /nueva tarea/i }));
      await user.click(screen.getByRole('button', { name: /^crear$/i }));

      expect(createTask).not.toHaveBeenCalled();
    });

    it('avisa al llamador para que refresque su lista de tareas', async () => {
      const user = userEvent.setup();
      const onTaskCreated = vi.fn();
      render(
        <ConversationOpportunity
          conversation={conLead}
          onTaskCreated={onTaskCreated}
        />,
      );

      await user.click(screen.getByRole('button', { name: /nueva tarea/i }));
      await user.type(screen.getByLabelText(/título de la tarea/i), 'Seguimiento');
      await user.click(screen.getByRole('button', { name: /^crear$/i }));

      await waitFor(() => expect(onTaskCreated).toHaveBeenCalled());
    });

    it('si falla, lo dice y NO pierde lo escrito', async () => {
      // Perder el texto obligaría a reescribirlo, y en la práctica se
      // abandona la tarea.
      createTask.mockRejectedValue(new Error('red caída'));
      const user = userEvent.setup();
      render(<ConversationOpportunity conversation={conLead} />);

      await user.click(screen.getByRole('button', { name: /nueva tarea/i }));
      const campo = screen.getByLabelText(/título de la tarea/i);
      await user.type(campo, 'Llamar');
      await user.click(screen.getByRole('button', { name: /^crear$/i }));

      expect(await screen.findByText(/no se pudo crear la tarea/i)).toBeInTheDocument();
      expect(campo).toHaveValue('Llamar');
    });
  });
});
