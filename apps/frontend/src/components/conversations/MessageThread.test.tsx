import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MessageThread } from './MessageThread';
import type { Message } from '@/types';

/**
 * EL HILO EXACTO.
 *
 * Lo que se comprueba aquí es que el hilo no miente: el orden es el que manda
 * el servidor, un mensaje que no es texto no aparece como una burbuja vacía, y
 * entrante/saliente se distingue con algo más que el color —quien no percibe
 * la diferencia entre azul y blanco no puede saber quién escribió qué—.
 *
 * NO se inventan eventos de sistema: en el esquema no existe un mensaje de tipo
 * SYSTEM, así que el hilo no dibuja ninguno. La entrega a una persona se enseña
 * en la cabecera, que es donde hay un contrato real que la respalda.
 */

const HOY = new Date();
const AYER = new Date(HOY.getTime() - 24 * 60 * 60 * 1000);
const SEMANA_PASADA = new Date(HOY.getTime() - 7 * 24 * 60 * 60 * 1000);

const mensaje = (extra: Partial<Message> = {}): Message => ({
  id: 'm1',
  body: 'Hola',
  type: 'TEXT',
  direction: 'INBOUND',
  status: 'RECEIVED',
  createdAt: HOY.toISOString(),
  ...extra,
});

describe('MessageThread', () => {
  it('sin mensajes lo dice', () => {
    render(<MessageThread messages={[]} />);
    expect(screen.getByText(/no hay mensajes/i)).toBeInTheDocument();
  });

  it('conserva el orden que manda el servidor', () => {
    render(
      <MessageThread
        messages={[
          mensaje({ id: 'm1', body: 'Primero' }),
          mensaje({ id: 'm2', body: 'Segundo' }),
          mensaje({ id: 'm3', body: 'Tercero' }),
        ]}
      />,
    );

    const textos = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
    expect(textos[0]).toContain('Primero');
    expect(textos[1]).toContain('Segundo');
    expect(textos[2]).toContain('Tercero');
  });

  describe('quién escribió', () => {
    it('un mensaje entrante se anuncia como recibido', () => {
      render(<MessageThread messages={[mensaje({ direction: 'INBOUND' })]} />);
      expect(screen.getByText('Recibido')).toBeInTheDocument();
    });

    it('un mensaje saliente se anuncia como enviado', () => {
      render(<MessageThread messages={[mensaje({ direction: 'OUTBOUND' })]} />);
      expect(screen.getByText('Enviado')).toBeInTheDocument();
    });

    it('un fallo se dice con texto, no solo con color', () => {
      render(
        <MessageThread
          messages={[mensaje({ direction: 'OUTBOUND', status: 'FAILED' })]}
        />,
      );
      expect(screen.getByText(/no se pudo enviar/i)).toBeInTheDocument();
    });
  });

  describe('mensajes que no son texto', () => {
    it('una imagen se nombra en vez de dejar la burbuja vacía', () => {
      render(
        <MessageThread messages={[mensaje({ type: 'IMAGE', body: null })]} />,
      );
      expect(screen.getByText('Imagen')).toBeInTheDocument();
    });

    it('un documento se nombra', () => {
      render(
        <MessageThread messages={[mensaje({ type: 'DOCUMENT', body: null })]} />,
      );
      expect(screen.getByText('Documento')).toBeInTheDocument();
    });

    it('un tipo desconocido no rompe el hilo', () => {
      render(
        <MessageThread messages={[mensaje({ type: 'RAREZA', body: null })]} />,
      );
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

    it('si el adjunto trae texto, el texto se enseña', () => {
      render(
        <MessageThread
          messages={[mensaje({ type: 'IMAGE', body: 'Mira el acabado' })]}
        />,
      );
      expect(screen.getByText('Mira el acabado')).toBeInTheDocument();
    });
  });

  describe('separadores de fecha', () => {
    it('agrupa por día y marca hoy y ayer con palabras', () => {
      render(
        <MessageThread
          messages={[
            mensaje({ id: 'm1', createdAt: AYER.toISOString() }),
            mensaje({ id: 'm2', createdAt: HOY.toISOString() }),
          ]}
        />,
      );

      expect(screen.getByText('Ayer')).toBeInTheDocument();
      expect(screen.getByText('Hoy')).toBeInTheDocument();
    });

    it('no repite el separador dentro del mismo día', () => {
      render(
        <MessageThread
          messages={[
            mensaje({ id: 'm1', createdAt: HOY.toISOString() }),
            mensaje({ id: 'm2', createdAt: HOY.toISOString() }),
          ]}
        />,
      );

      expect(screen.getAllByText('Hoy')).toHaveLength(1);
    });

    it('una fecha antigua se escribe, no se llama «hace mucho»', () => {
      render(
        <MessageThread
          messages={[mensaje({ createdAt: SEMANA_PASADA.toISOString() })]}
        />,
      );

      expect(screen.queryByText('Hoy')).toBeNull();
      expect(screen.queryByText('Ayer')).toBeNull();
      // Queda un separador con la fecha real del mensaje.
      expect(screen.getByRole('separator')).toBeInTheDocument();
    });
  });

  it('un texto larguísimo no se sale: se parte', () => {
    const largo = 'palabrainterminable'.repeat(20);
    render(<MessageThread messages={[mensaje({ body: largo })]} />);

    const burbuja = within(screen.getByRole('listitem')).getByText(largo);
    expect(burbuja.className).toContain('break-words');
  });

  it('el hilo se anuncia como el registro de la conversación', () => {
    render(<MessageThread messages={[mensaje()]} />);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});
