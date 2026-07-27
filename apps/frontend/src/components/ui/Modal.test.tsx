import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Título" onClose={onClose}>
        <p>Contenido</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the overlay (backdrop) is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Título" onClose={onClose}>
        <p>Contenido</p>
      </Modal>,
    );

    // The dialog role element is the panel; its parent is the overlay.
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside the panel content', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Título" onClose={onClose}>
        <p>Contenido interactivo</p>
      </Modal>,
    );

    fireEvent.mouseDown(screen.getByText('Contenido interactivo'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close (X) button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Título" onClose={onClose}>
        <p>Contenido</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the close button when hideCloseButton is set (forced confirmation flows)', () => {
    render(
      <Modal title="Título" onClose={() => {}} hideCloseButton>
        <p>Contenido</p>
      </Modal>,
    );

    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = render(
      <Modal title="Título" onClose={() => {}}>
        <p>Contenido</p>
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('renders footer content outside the scrollable body region', () => {
    render(
      <Modal title="Título" onClose={() => {}} footer={<button>Siguiente</button>}>
        <p>Contenido</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
  });
});
