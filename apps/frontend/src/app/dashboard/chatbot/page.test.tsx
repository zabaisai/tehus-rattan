import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChatbotPage from './page';

const getFlows = vi.fn();
const getChatbotSessions = vi.fn();
const deleteFlow = vi.fn();

vi.mock('@/lib/chatbot', async () => {
  const real = await vi.importActual<typeof import('@/lib/chatbot')>(
    '@/lib/chatbot',
  );
  return {
    ...real,
    getFlows: () => getFlows(),
    getChatbotSessions: (p: unknown) => getChatbotSessions(p),
    createFlow: vi.fn(),
    updateFlow: vi.fn(),
    publishFlow: vi.fn(),
    deleteFlow: (id: string) => deleteFlow(id),
  };
});

function flujo(overrides = {}) {
  return {
    id: 'f1',
    name: 'Bienvenida',
    isActive: false,
    publishedVersion: null,
    flow: { start: '', nodes: [] },
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatbotPage />
    </QueryClientProvider>,
  );
}

describe('ChatbotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChatbotSessions.mockResolvedValue([]);
  });

  it('sin flujos invita a crear el primero', async () => {
    getFlows.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(/Todavía no hay flujos/i),
    ).toBeInTheDocument();
  });

  it('un fallo de carga NO se ve como "todavía no hay flujos"', async () => {
    getFlows.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay flujos/i)).not.toBeInTheDocument();
  });

  it('un flujo sin publicar no se puede activar', async () => {
    getFlows.mockResolvedValue([flujo()]);
    renderPage();

    const boton = await screen.findByRole('button', { name: 'Activar' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute(
      'title',
      'Publica una versión antes de activarlo',
    );
  });

  it('explica por qué no se puede borrar un flujo en uso', async () => {
    getFlows.mockResolvedValue([flujo({ publishedVersion: 1 })]);
    deleteFlow.mockRejectedValue(new Error('en uso'));
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /Eliminar Bienvenida/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /hay conversaciones usándolo/i,
    );
  });
});
