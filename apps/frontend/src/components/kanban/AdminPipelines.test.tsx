import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Pipeline } from '@/types';
import { AdminPipelines } from './AdminPipelines';

const getPipelines = vi.fn();
const createPipeline = vi.fn();
const updatePipeline = vi.fn();
const createStage = vi.fn();
const updateStage = vi.fn();
const deleteStage = vi.fn();
const reorderStages = vi.fn();

vi.mock('@/lib/pipeline', async () => {
  // Las funciones puras (orden completo, límites, etiquetas) son las reales:
  // lo que se sustituye es la red.
  const real = await vi.importActual<typeof import('@/lib/pipeline')>('@/lib/pipeline');
  return {
    ...real,
    getPipelines: () => getPipelines(),
    createPipeline: (d: unknown) => createPipeline(d),
    updatePipeline: (id: string, d: unknown) => updatePipeline(id, d),
    deletePipeline: vi.fn(),
    createStage: (p: string, d: unknown) => createStage(p, d),
    updateStage: (p: string, s: string, d: unknown) => updateStage(p, s, d),
    deleteStage: (p: string, s: string) => deleteStage(p, s),
    reorderStages: (p: string, s: unknown) => reorderStages(p, s),
  };
});

function embudo(parcial: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'p1',
    name: 'Ventas',
    isDefault: true,
    order: 0,
    stages: [
      {
        id: 's1',
        name: 'Primer contacto',
        order: 0,
        color: '#131C4A',
        isInitial: true,
        probability: 10,
        type: 'OPEN',
      },
      { id: 's2', name: 'Cotizado', order: 1, color: null, isInitial: false, type: 'OPEN' },
    ],
    ...parcial,
  };
}

function pintar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminPipelines onCerrar={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('Administración de embudos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPipelines.mockResolvedValue([embudo()]);
  });

  it('enseña los embudos con cuántas etapas tiene cada uno', async () => {
    pintar();
    expect(await screen.findByText('Ventas')).toBeInTheDocument();
    expect(screen.getByText('2 etapas')).toBeInTheDocument();
  });

  it('marca cuál es la etapa de entrada', async () => {
    // Es la que recibe a quien acaba de escribir por primera vez. Sin verlo,
    // hay que adivinarlo por el nombre, y el nombre no lo decide el producto.
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    expect(screen.getByText('Entrada')).toBeInTheDocument();
  });

  it('la etapa de entrada NO se puede desmarcar, solo se cambia a otra', async () => {
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    // La que ya es entrada no ofrece el botón; la otra sí.
    const botones = screen.getAllByRole('button', { name: 'Marcar entrada' });
    expect(botones).toHaveLength(1);

    await userEvent.click(botones[0]);
    expect(updateStage).toHaveBeenCalledWith('p1', 's2', { isInitial: true });
  });

  it('la primera etapa de un embudo vacío nace como entrada', async () => {
    // Si no, el primer cliente cae en «la primera por orden», que es una regla
    // de reserva y no la decisión de nadie.
    getPipelines.mockResolvedValue([embudo({ stages: [] })]);
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.type(
      screen.getByLabelText('Nueva etapa en Ventas'),
      'Primer contacto',
    );
    await userEvent.click(screen.getByRole('button', { name: /Añadir etapa/ }));

    expect(createStage).toHaveBeenCalledWith('p1', {
      name: 'Primer contacto',
      isInitial: true,
    });
  });

  it('una etapa añadida a un embudo que ya tiene etapas NO roba la entrada', async () => {
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.type(screen.getByLabelText('Nueva etapa en Ventas'), 'Ganado');
    await userEvent.click(screen.getByRole('button', { name: /Añadir etapa/ }));

    expect(createStage).toHaveBeenCalledWith('p1', {
      name: 'Ganado',
      isInitial: false,
    });
  });

  it('reordenar manda el orden COMPLETO del embudo con posiciones 0..n-1', async () => {
    // El servidor exige todas las etapas sin huecos y rechaza con 400 un
    // orden parcial; antes se mandaban solo las dos intercambiadas.
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.click(screen.getByRole('button', { name: 'Bajar Primer contacto' }));

    expect(reorderStages).toHaveBeenCalledWith('p1', [
      { id: 's2', order: 0 },
      { id: 's1', order: 1 },
    ]);
  });

  it('con más etapas, las que no se mueven también viajan, en su sitio', async () => {
    getPipelines.mockResolvedValue([
      embudo({
        stages: [
          { id: 's1', name: 'Primer contacto', order: 0, color: null, isInitial: true, type: 'OPEN' },
          { id: 's2', name: 'Cotizado', order: 1, color: null, type: 'OPEN' },
          { id: 's3', name: 'Negociación', order: 2, color: null, type: 'OPEN' },
          { id: 's4', name: 'Ganado', order: 3, color: null, type: 'WON' },
        ],
      }),
    ]);
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.click(screen.getByRole('button', { name: 'Subir Negociación' }));

    const [, orden] = reorderStages.mock.calls[0] as [string, Array<{ id: string; order: number }>];
    expect(orden).toEqual([
      { id: 's1', order: 0 },
      { id: 's3', order: 1 },
      { id: 's2', order: 2 },
      { id: 's4', order: 3 },
    ]);
    expect(orden.map((o) => o.order)).toEqual([0, 1, 2, 3]);
  });

  it('el tipo de cada etapa se lee con palabras: Abierta, Ganada o Perdida', async () => {
    getPipelines.mockResolvedValue([
      embudo({
        stages: [
          { id: 's1', name: 'Nuevo', order: 0, color: null, isInitial: true, type: 'OPEN' },
          { id: 's2', name: 'Cerrado ganado', order: 1, color: null, type: 'WON' },
          { id: 's3', name: 'Cerrado perdido', order: 2, color: null, type: 'LOST' },
        ],
      }),
    ]);
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    expect(screen.getByText('Abierta')).toBeInTheDocument();
    expect(screen.getByText('Ganada')).toBeInTheDocument();
    expect(screen.getByText('Perdida')).toBeInTheDocument();
  });

  it('los nombres tienen el mismo tope que el servidor: 60 el embudo, 40 la etapa', async () => {
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    const etapa = screen.getByLabelText('Nueva etapa en Ventas');
    expect(etapa).toHaveAttribute('maxlength', '40');
    await userEvent.type(etapa, 'Seguimiento');
    expect(screen.getByText('11/40')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Nuevo embudo/ }));
    expect(screen.getByLabelText('Nombre del embudo')).toHaveAttribute('maxlength', '60');
    expect(screen.getByText('0/60')).toBeInTheDocument();
  });

  it('un 409 al poner el embudo por defecto llega con el motivo del servidor', async () => {
    getPipelines.mockResolvedValue([
      embudo(),
      embudo({ id: 'p2', name: 'Soporte', isDefault: false, order: 1 }),
    ]);
    updatePipeline.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message:
            'Otro cambio marcó un pipeline predeterminado al mismo tiempo. Vuelve a intentarlo.',
        },
      },
    });
    pintar();
    await screen.findByText('Ventas');

    await userEvent.click(screen.getByRole('button', { name: 'Poner Soporte por defecto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/al mismo tiempo/);
  });

  it('un 400 al reordenar llega con el motivo del servidor, no con un «no se pudo»', async () => {
    reorderStages.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'El orden debe incluir todas las etapas del pipeline' },
      },
    });
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.click(screen.getByRole('button', { name: 'Bajar Primer contacto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/todas las etapas/);
  });

  it('el motivo REAL del servidor llega a la pantalla', async () => {
    // «No se puede eliminar una etapa que tiene leads activos» dice qué hacer;
    // un «no se pudo» genérico esconde justo eso.
    deleteStage.mockRejectedValue({
      response: {
        data: {
          message:
            'No se puede eliminar una etapa que tiene leads activos. Mueve los leads primero.',
        },
      },
    });
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    // Ahora pasa por confirmación: borrar una etapa es definitivo y ya no se
    // ejecuta al primer clic sobre un icono sin texto.
    await userEvent.click(
      screen.getByRole('button', { name: 'Eliminar la etapa Cotizado' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Eliminar la etapa' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/leads activos/);
  });

  it('borrar una etapa AVISA antes, con su nombre y su consecuencia', async () => {
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.click(
      screen.getByRole('button', { name: 'Eliminar la etapa Cotizado' }),
    );

    expect(
      screen.getByText('¿Eliminar la etapa «Cotizado»?'),
    ).toBeInTheDocument();
    expect(deleteStage).not.toHaveBeenCalled();
  });

  it('el color se elige por su NOMBRE, no escribiendo un hexadecimal', async () => {
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.click(
      screen.getAllByRole('radio', { name: 'Verde' })[0],
    );

    await waitFor(() =>
      expect(updateStage).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
        { color: '#0E8A5F' },
      ),
    );
  });

  it('crea un embudo nuevo', async () => {
    pintar();
    await screen.findByText('Ventas');

    await userEvent.click(screen.getByRole('button', { name: /Nuevo embudo/ }));
    await userEvent.type(screen.getByLabelText('Nombre del embudo'), 'Soporte');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(createPipeline).toHaveBeenCalledWith({ name: 'Soporte' });
  });

  it('el embudo por defecto se ve, y solo los demás ofrecen serlo', async () => {
    getPipelines.mockResolvedValue([
      embudo(),
      embudo({ id: 'p2', name: 'Soporte', isDefault: false, order: 1 }),
    ]);
    pintar();
    await screen.findByText('Ventas');

    expect(screen.getByText('Por defecto')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Poner Soporte por defecto' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Poner Ventas por defecto' }),
    ).toBeNull();
  });
});
