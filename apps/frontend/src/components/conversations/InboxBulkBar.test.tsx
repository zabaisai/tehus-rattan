import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxBulkBar } from './InboxBulkBar';

const asesores = [
  { id: 'u1', name: 'Ana' },
  { id: 'u2', name: 'Beto' },
];

describe('InboxBulkBar', () => {
  it('no se dibuja sin selección: una barra con botones inertes enseña a ignorarla', () => {
    const { container } = render(
      <InboxBulkBar
        seleccionadas={[]}
        asesores={asesores}
        onAccion={vi.fn()}
        onLimpiar={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('dice cuántas hay seleccionadas, en singular y plural', () => {
    const { rerender } = render(
      <InboxBulkBar
        seleccionadas={['a']}
        asesores={asesores}
        onAccion={vi.fn()}
        onLimpiar={vi.fn()}
      />,
    );
    expect(screen.getByText('1 seleccionada')).toBeInTheDocument();

    rerender(
      <InboxBulkBar
        seleccionadas={['a', 'b']}
        asesores={asesores}
        onAccion={vi.fn()}
        onLimpiar={vi.fn()}
      />,
    );
    expect(screen.getByText('2 seleccionadas')).toBeInTheDocument();
  });

  it('asigna al asesor elegido', async () => {
    const onAccion = vi.fn();
    const user = userEvent.setup();
    render(
      <InboxBulkBar
        seleccionadas={['a', 'b']}
        asesores={asesores}
        onAccion={onAccion}
        onLimpiar={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/asignar a/i), 'u2');

    expect(onAccion).toHaveBeenCalledWith({ type: 'assign', assignedTo: 'u2' });
  });

  it.each([
    [/quitar asignación/i, { type: 'unassign' }],
    [/marcar leídas/i, { type: 'read' }],
    [/resolver/i, { type: 'status', status: 'RESOLVED' }],
    [/archivar/i, { type: 'status', status: 'ARCHIVED' }],
  ])('la acción %s envía lo esperado', async (etiqueta, esperado) => {
    const onAccion = vi.fn();
    const user = userEvent.setup();
    render(
      <InboxBulkBar
        seleccionadas={['a']}
        asesores={asesores}
        onAccion={onAccion}
        onLimpiar={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: etiqueta }));

    expect(onAccion).toHaveBeenCalledWith(esperado);
  });

  it('NO ofrece borrar en masa', () => {
    // Cerrar y archivar son reversibles; borrar no lo es, y hacerlo sobre
    // cincuenta conversaciones de golpe es el error que no se puede deshacer.
    render(
      <InboxBulkBar
        seleccionadas={['a']}
        asesores={asesores}
        onAccion={vi.fn()}
        onLimpiar={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /eliminar|borrar/i })).toBeNull();
  });

  it('no dispara la misma acción dos veces mientras está en curso', async () => {
    // Un doble clic no puede archivar dos veces ni dejar la barra a medias.
    let resolver: () => void = () => undefined;
    const onAccion = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolver = r;
        }),
    );
    const user = userEvent.setup();
    render(
      <InboxBulkBar
        seleccionadas={['a']}
        asesores={asesores}
        onAccion={onAccion}
        onLimpiar={vi.fn()}
      />,
    );

    const boton = screen.getByRole('button', { name: /archivar/i });
    await user.click(boton);
    await waitFor(() => expect(boton).toBeDisabled());

    resolver();
    await waitFor(() => expect(boton).not.toBeDisabled());
    expect(onAccion).toHaveBeenCalledTimes(1);
  });

  it('cancelar limpia la selección', async () => {
    const onLimpiar = vi.fn();
    const user = userEvent.setup();
    render(
      <InboxBulkBar
        seleccionadas={['a']}
        asesores={asesores}
        onAccion={vi.fn()}
        onLimpiar={onLimpiar}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onLimpiar).toHaveBeenCalled();
  });

  it('es una barra de herramientas con nombre para lectores de pantalla', () => {
    render(
      <InboxBulkBar
        seleccionadas={['a']}
        asesores={asesores}
        onAccion={vi.fn()}
        onLimpiar={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('toolbar', { name: /acciones sobre las conversaciones/i }),
    ).toBeInTheDocument();
  });
});
