import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaletaDeBusqueda } from './PaletaDeBusqueda';
import { useAuthStore } from '@/store/auth.store';
import { olvidarRecientes } from '@/lib/creacion-rapida';
import { rutaDelResultado, resultadosEnOrden } from '@/lib/busqueda';
import type { RespuestaDeBusqueda } from '@/lib/busqueda';
import { capacidadesDePrueba } from '@/lib/__fixtures__/tenant-capabilities.fixture';

// Capacidades de la empresa (Fase 4): todo activo salvo que la prueba lo apague.
let capacidades = capacidadesDePrueba();
vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>(
    '@/lib/tenant-capabilities',
  );
  return { ...real, useTenantCapabilities: () => capacidades };
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const buscarMock = vi.fn();
vi.mock('@/lib/busqueda', async () => {
  const real = await vi.importActual<typeof import('@/lib/busqueda')>('@/lib/busqueda');
  return { ...real, buscar: (...args: unknown[]) => buscarMock(...args) };
});

const RESPUESTA: RespuestaDeBusqueda = {
  consulta: 'laura',
  total: 3,
  grupos: [
    {
      tipo: 'contactos',
      total: 2,
      resultados: [
        {
          tipo: 'contactos',
          id: 'c1',
          titulo: 'Laura Martínez',
          subtitulo: '+57 300 111 0004',
          insignia: null,
          contactoId: 'c1',
          archivado: false,
        },
        {
          tipo: 'contactos',
          id: 'c2',
          titulo: 'Laura Gómez',
          subtitulo: '+57 300 111 0005',
          insignia: 'En papelera',
          contactoId: 'c2',
          archivado: true,
        },
      ],
    },
    {
      tipo: 'oportunidades',
      total: 1,
      resultados: [
        {
          tipo: 'oportunidades',
          id: 'l1',
          titulo: 'Sala Toscana',
          subtitulo: 'Laura Martínez',
          insignia: 'Negociación',
          contactoId: 'c1',
        },
      ],
    },
  ],
};

const SESION = { id: 'u1', companyId: 'e1', role: 'ADMIN', name: 'Ana', email: 'a@b.c' };

function montar(onCerrar = vi.fn()) {
  useAuthStore.setState({ user: SESION as never });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PaletaDeBusqueda onCerrar={onCerrar} />
    </QueryClientProvider>,
  );
  return { onCerrar };
}

describe('PaletaDeBusqueda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    olvidarRecientes();
    capacidades = capacidadesDePrueba();
    buscarMock.mockResolvedValue(RESPUESTA);
  });

  describe('módulos de la empresa (Fase 4)', () => {
    const CON_PRODUCTOS: RespuestaDeBusqueda = {
      ...RESPUESTA,
      total: 4,
      grupos: [
        ...RESPUESTA.grupos,
        {
          tipo: 'productos',
          total: 1,
          resultados: [
            {
              tipo: 'productos',
              id: 'p1',
              titulo: 'Sala Toscana (producto)',
              subtitulo: null,
              insignia: null,
              contactoId: null,
            },
          ],
        },
      ],
    };

    it('sin catálogo no hay filtro «Productos», y un grupo de productos no se pinta aunque llegue', async () => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false } });
      buscarMock.mockResolvedValue(CON_PRODUCTOS);
      const user = userEvent.setup();
      montar();

      expect(screen.queryByRole('button', { name: 'Productos' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cotizaciones' })).toBeInTheDocument();

      await user.type(screen.getByRole('combobox'), 'laura');
      const opciones = await screen.findAllByRole('option');

      expect(opciones).toHaveLength(3);
      expect(screen.queryByText('Sala Toscana (producto)')).not.toBeInTheDocument();
    });

    it('con un módulo apagado se piden SOLO los tipos permitidos', async () => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false } });
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');

      await waitFor(() => expect(buscarMock).toHaveBeenCalled());
      expect(buscarMock.mock.calls[0][0]).toMatchObject({
        tipos: ['contactos', 'conversaciones', 'oportunidades', 'cotizaciones'],
      });
    });

    it('el texto de ayuda nombra solo lo que se puede buscar', () => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false, quotes: false } });
      montar();

      expect(screen.getByRole('combobox')).toHaveAttribute(
        'placeholder',
        'Buscar contactos, conversaciones u oportunidades',
      );
    });

    it('con todo activo sigue nombrando los cinco tipos', () => {
      montar();

      expect(screen.getByRole('combobox')).toHaveAttribute(
        'placeholder',
        'Buscar contactos, conversaciones, oportunidades, productos o cotizaciones',
      );
    });
  });

  describe('antes de escribir', () => {
    it('pide un mínimo de caracteres y no consulta', async () => {
      montar();

      expect(screen.getByText(/al menos 2 caracteres/i)).toBeInTheDocument();
      expect(buscarMock).not.toHaveBeenCalled();
    });

    it('una sola letra tampoco consulta', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'l');

      await new Promise((r) => setTimeout(r, 400));
      expect(buscarMock).not.toHaveBeenCalled();
    });

    it('el foco empieza en el campo: la paleta se abre para escribir', () => {
      montar();

      expect(document.activeElement).toBe(screen.getByRole('combobox'));
    });
  });

  describe('resultados', () => {
    it('agrupa por tipo y muestra título y subtítulo', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');

      const opciones = await screen.findAllByRole('option');
      expect(opciones.map((o) => o.textContent)).toEqual([
        expect.stringContaining('Laura Martínez'),
        expect.stringContaining('Laura Gómez'),
        expect.stringContaining('Sala Toscana'),
      ]);
      // Las cabeceras de grupo, no los botones de filtro del mismo nombre.
      expect(screen.getAllByText('Contactos').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Oportunidades').length).toBeGreaterThan(0);
    });

    it('marca el archivado con texto, no solo con color', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');

      expect(await screen.findByText('En papelera')).toBeInTheDocument();
    });

    it('los resultados son opciones de una lista para el lector de pantalla', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');

      const opciones = await screen.findAllByRole('option');
      expect(opciones).toHaveLength(3);
      expect(opciones[0]).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('teclado', () => {
    it('las flechas mueven la selección y Enter abre el resultado', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');
      await screen.findAllByRole('option');

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      // Segundo resultado: el contacto archivado.
      expect(push).toHaveBeenCalledWith('/dashboard/pipeline?perfil=c2');
    });

    it('la selección da la vuelta al llegar al final', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');
      await screen.findAllByRole('option');

      // Tres resultados: tres flechas vuelven al primero.
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(push).toHaveBeenCalledWith('/dashboard/pipeline?perfil=c1');
    });

    it('cambiar el filtro devuelve la selección al principio', async () => {
      // Si no, Enter abriría un resultado que ya no está donde estaba.
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');
      await screen.findAllByRole('option');
      await user.keyboard('{ArrowDown}{ArrowDown}');

      await user.click(screen.getByRole('button', { name: 'Oportunidades' }));
      await waitFor(() => {
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('tras pulsar un filtro con el raton, el teclado SIGUE gobernando', async () => {
      // Defecto que encontro la QA del 2.1: el foco se quedaba en el chip, y a
      // partir de ahi las flechas no movian nada y Enter reactivaba el chip.
      // Con solo teclado o solo raton funcionaba; el camino mixto no.
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');
      await screen.findAllByRole('option');

      await user.click(screen.getByRole('button', { name: 'Contactos' }));
      expect(document.activeElement).toBe(screen.getByRole('combobox'));

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(push).toHaveBeenCalledWith('/dashboard/pipeline?perfil=c2');
    });

    it('cierra con Escape', async () => {
      const user = userEvent.setup();
      const { onCerrar } = montar();

      await user.keyboard('{Escape}');

      expect(onCerrar).toHaveBeenCalled();
    });
  });

  describe('filtros', () => {
    it('«Todo» no manda tipos; un tipo concreto sí', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');
      await waitFor(() => expect(buscarMock).toHaveBeenCalled());
      expect(buscarMock.mock.calls[0][0]).toMatchObject({ tipos: undefined });

      await user.click(screen.getByRole('button', { name: 'Productos' }));

      await waitFor(() => {
        const ultima = buscarMock.mock.calls.at(-1)![0];
        expect(ultima).toMatchObject({ tipos: ['productos'] });
      });
    });

    it('la papelera está fuera salvo que se pida', async () => {
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');
      await waitFor(() => expect(buscarMock).toHaveBeenCalled());
      expect(buscarMock.mock.calls[0][0].incluirPapelera).toBe(false);

      await user.click(screen.getByRole('button', { name: /Incluir papelera/ }));

      await waitFor(() => {
        expect(buscarMock.mock.calls.at(-1)![0].incluirPapelera).toBe(true);
      });
    });
  });

  describe('estados', () => {
    it('sin resultados ofrece buscar en la papelera', async () => {
      buscarMock.mockResolvedValue({ consulta: 'zzz', total: 0, grupos: [] });
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'zzz');

      expect(await screen.findByText(/Sin resultados/)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Buscar también en la papelera/ }),
      ).toBeInTheDocument();
    });

    it('un error se anuncia y no deja la lista en blanco', async () => {
      buscarMock.mockRejectedValue({ response: { status: 403 } });
      const user = userEvent.setup();
      montar();

      await user.type(screen.getByRole('combobox'), 'laura');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(/permiso/i);
    });
  });
});

describe('rutaDelResultado', () => {
  it('cada tipo lleva a una ruta que abre ese objeto', () => {
    expect(rutaDelResultado({ tipo: 'conversaciones', id: 'x1' } as never)).toBe(
      '/dashboard/conversations?c=x1',
    );
    expect(rutaDelResultado({ tipo: 'oportunidades', id: 'x2' } as never)).toBe(
      '/dashboard/pipeline?lead=x2',
    );
    expect(rutaDelResultado({ tipo: 'contactos', id: 'x3' } as never)).toBe(
      '/dashboard/pipeline?perfil=x3',
    );
    expect(rutaDelResultado({ tipo: 'cotizaciones', id: 'x4' } as never)).toBe(
      '/dashboard/quotes?open=x4',
    );
    expect(rutaDelResultado({ tipo: 'productos', id: 'x5' } as never)).toBe(
      '/dashboard/products?abrir=x5',
    );
  });

  it('escapa el identificador: un id raro no debe romper la URL', () => {
    expect(rutaDelResultado({ tipo: 'productos', id: 'a b&c' } as never)).toBe(
      '/dashboard/products?abrir=a%20b%26c',
    );
  });
});

describe('resultadosEnOrden', () => {
  it('aplana los grupos en el orden en que se ven', () => {
    expect(resultadosEnOrden(RESPUESTA).map((r) => r.id)).toEqual(['c1', 'c2', 'l1']);
  });

  it('sin respuesta devuelve lista vacía, no revienta', () => {
    expect(resultadosEnOrden(undefined)).toEqual([]);
  });
});
