import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxFilters } from './InboxFilters';

const contadores = { total: 12, mine: 3, unassigned: 4, unread: 5 };

describe('InboxFilters', () => {
  describe('pestañas con contador', () => {
    it('muestra las tres preguntas que un asesor se hace al entrar', () => {
      render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={vi.fn()} />,
      );

      expect(screen.getByRole('button', { name: /mías/i })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /sin asignar/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /sin leer/i }),
      ).toBeInTheDocument();
    });

    it('un contador en cero no se dibuja: un badge vacío es ruido', () => {
      render(
        <InboxFilters
          filtros={{}}
          contadores={{ ...contadores, unread: 0 }}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Sin leer' })).toBeInTheDocument();
    });

    it('sin contadores todavía no rompe', () => {
      render(<InboxFilters filtros={{}} onChange={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Mías' })).toBeInTheDocument();
    });
  });

  describe('cada pestaña reemplaza el filtro anterior', () => {
    it('«Mías» filtra por asignación y APAGA sin leer', async () => {
      // Dejar restos de la pestaña anterior produce combinaciones que el
      // usuario no pidió y que luego no sabe deshacer.
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters
          filtros={{ unread: true }}
          contadores={contadores}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /mías/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ assigned: 'me', unread: false }),
      );
    });

    it('«Sin leer» apaga el filtro de asignación', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters
          filtros={{ assigned: 'me' }}
          contadores={contadores}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /sin leer/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ unread: true, assigned: undefined }),
      );
    });

    it('«Todas» limpia ambos', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters
          filtros={{ assigned: 'me', unread: true }}
          contadores={contadores}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /todas/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ assigned: undefined, unread: false }),
      );
    });

    it('conserva la búsqueda al cambiar de pestaña', async () => {
      // Perder lo que se estaba buscando al pulsar una pestaña obliga a
      // reescribirlo y hace que las pestañas den miedo.
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters
          filtros={{ search: 'Ana' }}
          contadores={contadores}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /mías/i }));

      expect(onChange.mock.calls[0][0].search).toBe('Ana');
    });
  });

  describe('búsqueda y estado', () => {
    it('propaga lo que se escribe', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={onChange} />,
      );

      await user.type(screen.getByLabelText(/buscar conversaciones/i), 'A');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'A' }),
      );
    });

    it('elegir «todos los estados» quita el filtro en vez de mandar vacío', async () => {
      // Un `status=` en la URL es un filtro que el backend tendría que
      // aprender a ignorar.
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters
          filtros={{ status: 'OPEN' }}
          contadores={contadores}
          onChange={onChange}
        />,
      );

      await user.selectOptions(screen.getByLabelText('Estado'), '');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined }),
      );
    });

    it('«Limpiar» solo aparece cuando hay algo que limpiar', () => {
      const { rerender } = render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={vi.fn()} />,
      );
      expect(screen.queryByRole('button', { name: /limpiar/i })).toBeNull();

      rerender(
        <InboxFilters
          filtros={{ search: 'x' }}
          contadores={contadores}
          onChange={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: /limpiar/i }),
      ).toBeInTheDocument();
    });

    it('«Limpiar» no toca la pestaña activa', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <InboxFilters
          filtros={{ search: 'x', assigned: 'me' }}
          contadores={contadores}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /limpiar/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ search: undefined, assigned: 'me' }),
      );
    });
  });
});
