import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxFilters } from './InboxFilters';
import { aplicarCambios } from '@/lib/inbox-url';
import type { FiltrosBandeja } from '@/lib/conversations';

/**
 * El componente ya no emite filtros completos: emite el CAMBIO, y quien navega
 * lo aplica sobre el estado de la URL. Para que estas pruebas sigan hablando de
 * comportamiento y no de la forma del objeto, aplican el cambio igual que lo
 * hace la pantalla y comprueban el resultado.
 */
const resultado = (previos: FiltrosBandeja, cambios: unknown) =>
  aplicarCambios(
    { filtros: previos, conversacionId: null, perfilAbierto: false },
    cambios as Parameters<typeof aplicarCambios>[1],
  ).filtros;

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

  describe('las cuatro caben enteras', () => {
    it('ninguna etiqueta se trunca: son los cuatro filtros principales', () => {
      // Con `flex-1` las cuatro se repartian el ancho a partes iguales y
      // «Sin asignar» quedaba en «Sin as…». Una pestaña principal no puede
      // depender de un tooltip para saber que dice.
      render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={vi.fn()} />,
      );

      for (const etiqueta of ['Todas', 'Mías', 'Sin asignar', 'Sin leer']) {
        const boton = screen.getByRole('button', { name: new RegExp('^' + etiqueta) });
        const texto = boton.querySelector('span');
        expect(texto?.className).not.toContain('truncate');
        expect(texto?.textContent).toBe(etiqueta);
      }
    });

    it('no se reparten el ancho a partes iguales: cada una ocupa lo suyo', () => {
      render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={vi.fn()} />,
      );

      const boton = screen.getByRole('button', { name: /^Sin asignar/ });
      expect(boton.className).not.toContain('flex-1');
    });

    it('la etiqueta no se parte en dos lineas', () => {
      render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={vi.fn()} />,
      );
      const texto = screen
        .getByRole('button', { name: /^Sin asignar/ })
        .querySelector('span');
      expect(texto?.className).toContain('whitespace-nowrap');
    });

    it('los contadores siguen visibles junto a su pestaña', () => {
      render(
        <InboxFilters filtros={{}} contadores={contadores} onChange={vi.fn()} />,
      );
      expect(
        screen.getByRole('button', { name: /^Sin leer/ }),
      ).toHaveTextContent('5');
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

      const f = resultado({ unread: true }, onChange.mock.calls[0][0]);
      expect(f.assigned).toBe('me');
      expect(f.unread).toBeUndefined();
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

      const f = resultado({ assigned: 'me' }, onChange.mock.calls[0][0]);
      expect(f.unread).toBe(true);
      expect(f.assigned).toBeUndefined();
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

      const f = resultado(
        { assigned: 'me', unread: true },
        onChange.mock.calls[0][0],
      );
      expect(f.assigned).toBeUndefined();
      expect(f.unread).toBeUndefined();
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

      expect(resultado({ search: 'Ana' }, onChange.mock.calls[0][0]).search).toBe(
        'Ana',
      );
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

      expect(resultado({}, onChange.mock.calls[0][0]).search).toBe('A');
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

      expect(
        resultado({ status: 'OPEN' }, onChange.mock.calls[0][0]).status,
      ).toBeUndefined();
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

      const f = resultado(
        { search: 'x', assigned: 'me' },
        onChange.mock.calls[0][0],
      );
      expect(f.search).toBeUndefined();
      expect(f.assigned).toBe('me');
    });
  });
});
