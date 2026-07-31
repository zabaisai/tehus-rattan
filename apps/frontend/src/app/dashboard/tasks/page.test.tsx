import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksPage from './page';

const getTasks = vi.fn();

vi.mock('@/lib/tasks', async () => {
  const real = await vi.importActual<typeof import('@/lib/tasks')>('@/lib/tasks');
  return {
    ...real,
    getTasks: () => getTasks(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    deleteTask: vi.fn(),
  };
});

vi.mock('@/lib/use-realtime', async () => {
  const real = await vi.importActual<typeof import('@/lib/use-realtime')>(
    '@/lib/use-realtime',
  );
  return { ...real, useRealtime: () => ({ enVivo: false }) };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TasksPage />
    </QueryClientProvider>,
  );
}

describe('TasksPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin tareas lo dice', async () => {
    getTasks.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No hay tareas.')).toBeInTheDocument();
  });

  it('un fallo de carga NO se ve como "no hay tareas"', async () => {
    getTasks.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No hay tareas.')).not.toBeInTheDocument();
  });

  it('distingue una sesión caducada de un servidor caído', async () => {
    getTasks.mockRejectedValue({ response: { status: 401 } });
    renderPage();
    expect(await screen.findByText(/sesión caducó/i)).toBeInTheDocument();
  });
});
