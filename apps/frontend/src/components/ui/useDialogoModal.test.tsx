import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

/** Pantalla con un botón fuera del modal: es a donde NO debe irse el foco. */
function Anfitrion({
  onClose = () => {},
  children,
}: {
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <button type="button">Fuera del modal</button>
      <Modal title="Diálogo de prueba" onClose={onClose}>
        {children ?? (
          <>
            <button type="button">Uno</button>
            <button type="button">Dos</button>
          </>
        )}
      </Modal>
    </>
  );
}

describe('useDialogoModal', () => {
  describe('el foco no se escapa', () => {
    it('tabular hasta el final vuelve al principio, no sale al fondo', async () => {
      // `aria-modal="true"` le dice al lector de pantalla que el resto de la
      // página no existe. Si el tabulador sí puede salir, la promesa es falsa.
      const user = userEvent.setup();
      render(<Anfitrion />);

      const fuera = screen.getByRole('button', { name: 'Fuera del modal' });

      // Más tabulaciones que elementos hay dentro.
      for (let i = 0; i < 8; i++) {
        await user.tab();
        expect(document.activeElement).not.toBe(fuera);
      }
    });

    it('shift+tab desde el primero va al último, no al fondo', async () => {
      const user = userEvent.setup();
      render(<Anfitrion />);

      const fuera = screen.getByRole('button', { name: 'Fuera del modal' });
      for (let i = 0; i < 5; i++) {
        await user.tab({ shift: true });
        expect(document.activeElement).not.toBe(fuera);
      }
    });

    it('el foco inicial entra en el diálogo', async () => {
      render(<Anfitrion />);

      const dialogo = screen.getByRole('dialog');
      expect(dialogo.contains(document.activeElement)).toBe(true);
    });
  });

  describe('cierre', () => {
    it('Escape cierra', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<Anfitrion onClose={onClose} />);

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('con dos diálogos, Escape cierra SOLO el de arriba', async () => {
      // Cada diálogo escuchaba Escape en `document` por su cuenta, así que una
      // sola pulsación disparaba los dos `onClose`: abrir "Agregar producto"
      // dentro de una oportunidad y pulsar Escape cerraba las dos cosas.
      const cerrarFondo = vi.fn();
      const cerrarEncima = vi.fn();
      const user = userEvent.setup();

      render(
        <>
          <Modal title="Fondo" onClose={cerrarFondo}>
            <button type="button">A</button>
          </Modal>
          <Modal title="Encima" onClose={cerrarEncima} stackedZIndex>
            <button type="button">B</button>
          </Modal>
        </>,
      );

      await user.keyboard('{Escape}');

      expect(cerrarEncima).toHaveBeenCalledTimes(1);
      expect(cerrarFondo).not.toHaveBeenCalled();
    });

    it('el foco vuelve a quien abrió', async () => {
      // Sin esto, quien navega con teclado vuelve al principio de la página
      // cada vez que cierra algo.
      const user = userEvent.setup();

      function Conmutador() {
        const [abierto, setAbierto] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setAbierto(true)}>
              Abrir
            </button>
            {abierto && (
              <Modal title="X" onClose={() => setAbierto(false)}>
                <button type="button">Dentro</button>
              </Modal>
            )}
          </>
        );
      }

      render(<Conmutador />);
      const disparador = screen.getByRole('button', { name: 'Abrir' });

      await user.click(disparador);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(disparador);
    });
  });

  describe('fondo', () => {
    it('bloquea el scroll mientras está abierto y lo restaura al cerrar', async () => {
      const user = userEvent.setup();

      function Conmutador() {
        const [abierto, setAbierto] = useState(true);
        return abierto ? (
          <Modal title="X" onClose={() => setAbierto(false)}>
            <button type="button">Dentro</button>
          </Modal>
        ) : null;
      }

      render(<Conmutador />);
      expect(document.body.style.overflow).toBe('hidden');

      await user.keyboard('{Escape}');

      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('con dos diálogos, cerrar el de arriba NO desbloquea el fondo', async () => {
      const user = userEvent.setup();

      function Dos() {
        const [encima, setEncima] = useState(true);
        return (
          <>
            <Modal title="Fondo" onClose={() => {}}>
              <button type="button">A</button>
            </Modal>
            {encima && (
              <Modal title="Encima" onClose={() => setEncima(false)} stackedZIndex>
                <button type="button">B</button>
              </Modal>
            )}
          </>
        );
      }

      render(<Dos />);
      expect(document.body.style.overflow).toBe('hidden');

      await user.keyboard('{Escape}');

      // Queda uno abierto: desbloquear aquí dejaría el fondo desplazable
      // debajo de un diálogo todavía visible.
      expect(document.body.style.overflow).toBe('hidden');
    });
  });
});
