import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * UN GESTO, UNA ACCIÓN.
 *
 * Se escribió esperando encontrar aquí el defecto de reentrada que 3.x
 * encontró en la fusión —dos clics antes del re-render, dos llamadas—, y que
 * allí obligó a un candado síncrono con `useRef`. **No está.** React 19 vacía
 * los eventos discretos de forma síncrona, así que `setSaving(true)` ya se ha
 * aplicado cuando llega el segundo clic y `disabled` lo detiene. Comprobado
 * con `fireEvent` sin `await` en medio, que es la condición más exigente que
 * se puede montar.
 *
 * Por eso NO se le ha añadido un candado: sería una defensa sin defecto que
 * la justifique. Lo que sí queda es esta prueba, que fija el comportamiento:
 * este diálogo confirma las acciones destructivas de todo el producto, y si
 * alguien quitara el `disabled` habría que enterarse aquí y no en producción.
 */
describe('ConfirmDialog: reentrada', () => {
  it('dos clics en el MISMO tick ejecutan la acción una sola vez', async () => {
    let resolver: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolver = r;
        }),
    );

    render(
      <ConfirmDialog
        title="Archivar contacto"
        message="Saldrá de la lista de activos."
        confirmLabel="Archivar"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const boton = screen.getByRole('button', { name: 'Archivar' });

    // `fireEvent` y no `userEvent`: `userEvent` espera al re-render entre un
    // clic y el siguiente, así que el botón ya está deshabilitado y el defecto
    // no se reproduce. Un doble clic real no espera a nada. Los dos eventos
    // van sin `await` en medio, que es la condición exacta de la carrera.
    fireEvent.click(boton);
    fireEvent.click(boton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolver?.();
  });

  it('si la acción falla, se puede reintentar', async () => {
    // El candado no puede quedarse echado para siempre: un fallo de red tiene
    // que dejar volver a intentarlo, que es justo lo que el diálogo ofrece.
    const usuario = userEvent.setup();
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValueOnce(undefined);

    render(
      <ConfirmDialog
        title="Archivar contacto"
        message="Saldrá de la lista de activos."
        confirmLabel="Archivar"
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const boton = screen.getByRole('button', { name: 'Archivar' });
    await usuario.click(boton);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Archivar' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
