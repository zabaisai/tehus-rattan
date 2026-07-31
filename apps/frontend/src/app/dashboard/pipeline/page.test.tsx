import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PipelinePage from './page';

const getPipelines = vi.fn();

vi.mock('@/lib/pipeline', async () => {
  const real = await vi.importActual<typeof import('@/lib/pipeline')>(
    '@/lib/pipeline',
  );
  return { ...real, getPipelines: () => getPipelines() };
});

vi.mock('@/lib/use-realtime', async () => {
  const real = await vi.importActual<typeof import('@/lib/use-realtime')>(
    '@/lib/use-realtime',
  );
  return { ...real, useRealtime: () => ({ enVivo: false }) };
});

vi.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="tablero" />,
}));

function pipeline(overrides = {}) {
  return {
    id: 'p1',
    name: 'Ventas',
    isDefault: true,
    stages: [],
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PipelinePage />
    </QueryClientProvider>,
  );
}

describe('PipelinePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin pipelines lo dice', async () => {
    getPipelines.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText('No hay pipelines creados todavía.'),
    ).toBeInTheDocument();
  });

  it('un fallo de carga NO se ve como "no hay pipelines"', async () => {
    getPipelines.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText('No hay pipelines creados todavía.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument();
  });

  it('con un solo pipeline no dibuja el selector: un desplegable de una opción es ruido', async () => {
    getPipelines.mockResolvedValue([pipeline()]);
    renderPage();

    await screen.findByTestId('tablero');
    expect(screen.queryByLabelText('Pipeline')).not.toBeInTheDocument();
  });

  it('con varios pipelines aparece el selector', async () => {
    getPipelines.mockResolvedValue([
      pipeline(),
      pipeline({ id: 'p2', name: 'Posventa', isDefault: false }),
    ]);
    renderPage();

    expect(await screen.findByLabelText('Pipeline')).toBeInTheDocument();
  });
});
