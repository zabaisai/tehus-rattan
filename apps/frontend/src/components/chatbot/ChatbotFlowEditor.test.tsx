import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatbotFlowEditor } from './ChatbotFlowEditor';
import { validarFlujo, type FlujoChatbot } from '@/lib/chatbot';

const flujo: FlujoChatbot = {
  start: 'paso1',
  nodes: [
    {
      id: 'paso1',
      type: 'menu',
      text: '¿Qué necesitas?',
      options: [{ label: 'Precio', next: 'paso2' }],
    },
    { id: 'paso2', type: 'end', text: 'Cuesta 100' },
  ],
};

describe('validarFlujo (cliente)', () => {
  // Espeja la del servidor. El servidor es la autoridad; aquí solo se
  // adelanta el aviso para que editar no sea ensayo y error.
  it('un flujo correcto no da problemas', () => {
    expect(validarFlujo(flujo)).toEqual([]);
  });

  it('detecta un paso sin texto', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [{ id: 'a', type: 'message', text: '', next: 'a' }],
    });

    expect(problemas.some((p) => /texto/i.test(p.mensaje))).toBe(true);
  });

  it('detecta un enlace a un paso inexistente', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [{ id: 'a', type: 'message', text: 'hola', next: 'fantasma' }],
    });

    expect(problemas.some((p) => /no existe/i.test(p.mensaje))).toBe(true);
  });

  it('detecta pasos inalcanzables', () => {
    const problemas = validarFlujo({
      start: 'a',
      nodes: [
        { id: 'a', type: 'end', text: 'fin' },
        { id: 'suelto', type: 'end', text: 'nadie llega' },
      ],
    });

    expect(problemas.some((p) => p.nodeId === 'suelto')).toBe(true);
  });
});

describe('ChatbotFlowEditor', () => {
  it('marca cuál es el paso inicial', () => {
    render(<ChatbotFlowEditor flujo={flujo} onChange={vi.fn()} />);

    expect(screen.getByText('Inicio')).toBeInTheDocument();
  });

  it('permite cambiar el paso inicial', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChatbotFlowEditor flujo={flujo} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /marcar inicio/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ start: 'paso2' }),
    );
  });

  it('el destino se elige de una lista, no se escribe', async () => {
    // Es lo que hace imposible el error más común: un enlace a un paso que
    // no existe.
    const conMensaje: FlujoChatbot = {
      start: 'a',
      nodes: [
        { id: 'a', type: 'message', text: 'hola', next: 'b' },
        { id: 'b', type: 'end', text: 'fin' },
      ],
    };
    render(<ChatbotFlowEditor flujo={conMensaje} onChange={vi.fn()} />);

    const destino = screen.getByLabelText(/paso siguiente de a/i);
    expect(destino.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'b' })).toBeInTheDocument();
  });

  it('un paso no se puede enlazar a sí mismo desde el desplegable', async () => {
    // Un bucle de un solo paso no tiene ningún uso legítimo y el tope de
    // pasos del motor lo cortaría entregando la conversación.
    const conMensaje: FlujoChatbot = {
      start: 'a',
      nodes: [
        { id: 'a', type: 'message', text: 'hola', next: 'b' },
        { id: 'b', type: 'end', text: 'fin' },
      ],
    };
    render(<ChatbotFlowEditor flujo={conMensaje} onChange={vi.fn()} />);

    const opciones = Array.from(
      screen.getByLabelText(/paso siguiente de a/i).querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(opciones).not.toContain('a');
  });

  it('añade un paso nuevo', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChatbotFlowEditor flujo={flujo} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /añadir paso/i }));

    expect(onChange.mock.calls[0][0].nodes).toHaveLength(3);
  });

  it('el primer paso de un flujo vacío se marca como inicio solo', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatbotFlowEditor flujo={{ start: '', nodes: [] }} onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: /añadir paso/i }));

    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente.start).toBe(siguiente.nodes[0].id);
  });

  describe('al eliminar un paso', () => {
    it('limpia los enlaces que apuntaban a él', async () => {
      // Dejarlos colgando produce un "lleva a un paso que no existe" que el
      // usuario no provocó.
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<ChatbotFlowEditor flujo={flujo} onChange={onChange} />);

      await user.click(
        screen.getByRole('button', { name: /eliminar el paso paso2/i }),
      );

      const siguiente = onChange.mock.calls[0][0];
      expect(siguiente.nodes[0].options).toHaveLength(0);
    });

    it('elige otro paso inicial si se borra el inicio', async () => {
      // Si no, el flujo queda sin punto de entrada y deja de poder
      // publicarse sin que se vea por qué.
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<ChatbotFlowEditor flujo={flujo} onChange={onChange} />);

      await user.click(
        screen.getByRole('button', { name: /eliminar el paso paso1/i }),
      );

      expect(onChange.mock.calls[0][0].start).toBe('paso2');
    });
  });

  it('cambiar el tipo descarta lo que ya no aplica', async () => {
    // Unas opciones colgando de un paso que ya no es menú se guardarían y no
    // se usarían nunca.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChatbotFlowEditor flujo={flujo} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText(/tipo del paso paso1/i), 'end');

    expect(onChange.mock.calls[0][0].nodes[0].options).toBeUndefined();
  });

  it('muestra los problemas del paso donde están', () => {
    const roto: FlujoChatbot = {
      start: 'a',
      nodes: [{ id: 'a', type: 'menu', text: 'elige', options: [] }],
    };
    render(<ChatbotFlowEditor flujo={roto} onChange={vi.fn()} />);

    expect(screen.getByText(/menú sin opciones/i)).toBeInTheDocument();
  });

  it('los problemas del flujo entero se anuncian aparte', () => {
    render(
      <ChatbotFlowEditor
        flujo={{ start: 'inexistente', nodes: [{ id: 'a', type: 'end' }] }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/inicial no existe/i);
  });
});
