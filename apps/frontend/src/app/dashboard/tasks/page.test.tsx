import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksPage from './page';

const getTasks = vi.fn();

/** La URL de la prueba. `?abrir=` es el enlace profundo desde el Inicio. */
let parametros = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => parametros,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/tasks',
}));

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

const TAREA = {
  id: 't1',
  title: 'Llamar a Laura',
  description: null,
  dueDate: null,
  priority: 'HIGH',
  type: 'CALL',
  status: 'PENDING',
  leadId: null,
  contactId: null,
  assignedTo: null,
  lead: null,
  contact: null,
  agent: null,
};

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parametros = new URLSearchParams();
  });

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

  describe('enlace profundo `?abrir=`', () => {
    it('abre la tarea que nombra la URL', async () => {
      parametros = new URLSearchParams('abrir=t1');
      getTasks.mockResolvedValue([TAREA]);
      renderPage();

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Llamar a Laura')).toBeInTheDocument();
    });

    it('un id que ya no existe NO abre un diálogo vacío', async () => {
      // Una tarea completada o borrada deja enlaces vivos por ahí.
      parametros = new URLSearchParams('abrir=borrada');
      getTasks.mockResolvedValue([TAREA]);
      renderPage();

      await screen.findByText('Llamar a Laura');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('sin parámetro no abre nada', async () => {
      getTasks.mockResolvedValue([TAREA]);
      renderPage();

      await screen.findByText('Llamar a Laura');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
