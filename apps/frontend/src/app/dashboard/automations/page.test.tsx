import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AutomationsPage from './page';

const getAutomations = vi.fn();
const getAutomationRuns = vi.fn();
const updateAutomation = vi.fn();
const deleteAutomation = vi.fn();

vi.mock('@/lib/automations', async () => {
  const real = await vi.importActual<typeof import('@/lib/automations')>(
    '@/lib/automations',
  );
  return {
    ...real,
    getAutomations: () => getAutomations(),
    getAutomationRuns: (p: unknown) => getAutomationRuns(p),
    createAutomation: vi.fn(),
    updateAutomation: (id: string, p: unknown) => updateAutomation(id, p),
    deleteAutomation: (id: string) => deleteAutomation(id),
  };
});

vi.mock('@/lib/users', () => ({ getCompanyUsers: () => Promise.resolve([]) }));

function automatizacion(overrides = {}) {
  return {
    id: 'a1',
    name: 'Saludo inicial',
    trigger: 'FIRST_MESSAGE',
    isActive: true,
    version: 2,
    actions: [{ type: 'SEND_MESSAGE' }],
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutomationsPage />
    </QueryClientProvider>,
  );
}

describe('AutomationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAutomationRuns.mockResolvedValue([]);
  });

  it('sin automatizaciones sugiere la primera regla', async () => {
    getAutomations.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText('Todavía no hay automatizaciones'),
    ).toBeInTheDocument();
    expect(screen.getByText(/saludar automáticamente/i)).toBeInTheDocument();
  });

  it('un fallo de carga NO se disfraza de "todavía no hay ninguna"', async () => {
    getAutomations.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText('Todavía no hay automatizaciones'),
    ).not.toBeInTheDocument();
  });

  it('un AGENT ve que le falta permiso, no una lista vacía', async () => {
    getAutomations.mockRejectedValue({ response: { status: 403 } });
    renderPage();

    expect(await screen.findByText(/No tienes permiso/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Todavía no hay automatizaciones'),
    ).not.toBeInTheDocument();
  });

  it('avisa cuando pausar falla, en vez de dejar la regla mandando mensajes en silencio', async () => {
    getAutomations.mockResolvedValue([automatizacion()]);
    updateAutomation.mockRejectedValue({
      response: { data: { message: 'La automatización no existe.' } },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Pausar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /La automatización no existe/i,
    );
  });

  it('avisa cuando eliminar falla', async () => {
    getAutomations.mockResolvedValue([automatizacion()]);
    deleteAutomation.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /Eliminar Saludo inicial/i }),
    );

    await waitFor(() => expect(deleteAutomation).toHaveBeenCalledWith('a1'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('muestra la versión de la regla: el historial de ejecuciones no se entiende sin ella', async () => {
    getAutomations.mockResolvedValue([automatizacion()]);
    renderPage();

    expect(await screen.findByText('v2')).toBeInTheDocument();
  });

  it('el historial vacío lo dice, no queda en blanco', async () => {
    getAutomations.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText(/Todavía no se ha ejecutado ninguna automatización/i),
    ).toBeInTheDocument();
  });
});
