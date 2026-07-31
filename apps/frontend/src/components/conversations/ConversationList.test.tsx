import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationList } from './ConversationList';
import type { ConversacionBandeja } from '@/lib/conversations';

const conversacion = (
  extra: Partial<ConversacionBandeja> = {},
): ConversacionBandeja =>
  ({
    id: 'c1',
    status: 'OPEN',
    stage: null,
    isPaused: false,
    channel: 'whatsapp',
    lastMessageAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contact: { id: 'k1', name: 'Ana', phone: '+573001112233' },
    agent: null,
    unreadCount: 0,
    lastReadAt: null,
    ...extra,
  }) as ConversacionBandeja;

describe('ConversationList', () => {
  it('sin resultados lo dice en vez de quedarse en blanco', () => {
    render(
      <ConversationList conversations={[]} selectedId={null} onSelect={vi.fn()} />,
    );

    expect(screen.getByText(/no hay conversaciones/i)).toBeInTheDocument();
  });

  describe('sin leer', () => {
    it('muestra el contador', () => {
      render(
        <ConversationList
          conversations={[conversacion({ unreadCount: 3 })]}
          selectedId={null}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('3 sin leer')).toBeInTheDocument();
    });

    it('sin mensajes nuevos no dibuja contador', () => {
      render(
        <ConversationList
          conversations={[conversacion({ unreadCount: 0 })]}
          selectedId={null}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.queryByLabelText(/sin leer/)).toBeNull();
    });
  });

  describe('quién la atiende', () => {
    it('«Sin asignar» se dice explícitamente', () => {
      // Es lo que hay que resolver: en una bandeja compartida, no verlo
      // significa que nadie la está atendiendo.
      render(
        <ConversationList
          conversations={[conversacion({ agent: null })]}
          selectedId={null}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.getByText('Sin asignar')).toBeInTheDocument();
    });

    it('con responsable muestra su nombre', () => {
      render(
        <ConversationList
          conversations={[conversacion({ agent: { id: 'u1', name: 'Beto' } })]}
          selectedId={null}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.getByText('Beto')).toBeInTheDocument();
      expect(screen.queryByText('Sin asignar')).toBeNull();
    });
  });

  it('el estado se muestra en español, no como constante', () => {
    render(
      <ConversationList
        conversations={[conversacion({ status: 'RESOLVED' as never })]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Resuelta')).toBeInTheDocument();
    expect(screen.queryByText('RESOLVED')).toBeNull();
  });

  it('sin nombre de contacto cae al teléfono', () => {
    render(
      <ConversationList
        conversations={[
          conversacion({
            contact: { id: 'k1', name: null, phone: '+573001112233' } as never,
          }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('+573001112233')).toBeInTheDocument();
  });

  describe('selección para acciones masivas', () => {
    it('no hay casillas si el llamador no permite seleccionar', () => {
      render(
        <ConversationList
          conversations={[conversacion()]}
          selectedId={null}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('marcar la casilla NO abre la conversación', async () => {
      // Son dos intenciones distintas: seleccionar para actuar en lote y
      // abrir para leer. Confundirlas hace imposible seleccionar varias.
      const onSelect = vi.fn();
      const onToggle = vi.fn();
      const user = userEvent.setup();
      render(
        <ConversationList
          conversations={[conversacion()]}
          selectedId={null}
          onSelect={onSelect}
          seleccionadas={[]}
          onToggleSeleccion={onToggle}
        />,
      );

      await user.click(screen.getByRole('checkbox'));

      expect(onToggle).toHaveBeenCalledWith('c1');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('refleja lo ya seleccionado', () => {
      render(
        <ConversationList
          conversations={[conversacion()]}
          selectedId={null}
          onSelect={vi.fn()}
          seleccionadas={['c1']}
          onToggleSeleccion={vi.fn()}
        />,
      );

      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('la casilla tiene nombre accesible con el contacto', () => {
      render(
        <ConversationList
          conversations={[conversacion()]}
          selectedId={null}
          onSelect={vi.fn()}
          seleccionadas={[]}
          onToggleSeleccion={vi.fn()}
        />,
      );

      expect(
        screen.getByLabelText(/seleccionar la conversación de ana/i),
      ).toBeInTheDocument();
    });
  });
});
