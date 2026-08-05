import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('@/lib/pipeline', () => ({
  getPipelines: () => getPipelines(),
  createPipeline: (d: unknown) => createPipeline(d),
  updatePipeline: (id: string, d: unknown) => updatePipeline(id, d),
  deletePipeline: vi.fn(),
  createStage: (p: string, d: unknown) => createStage(p, d),
  updateStage: (p: string, s: string, d: unknown) => updateStage(p, s, d),
  deleteStage: (p: string, s: string) => deleteStage(p, s),
  reorderStages: (p: string, s: unknown) => reorderStages(p, s),
}));

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
      },
      { id: 's2', name: 'Cotizado', order: 1, color: null, isInitial: false },
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

  it('reordenar INTERCAMBIA los órdenes, no reasigna uno solo', async () => {
    // Mover una etapa sola dejaría dos con el mismo número, y entonces el
    // orden en pantalla depende de cómo desempate la base.
    pintar();
    await userEvent.click(await screen.findByText(/Ventas/));

    await userEvent.click(screen.getByRole('button', { name: 'Bajar Primer contacto' }));

    expect(reorderStages).toHaveBeenCalledWith('p1', [
      { id: 's1', order: 1 },
      { id: 's2', order: 0 },
    ]);
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

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Cotizado' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/leads activos/);
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
