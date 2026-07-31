import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeletionRequestsPage from './page';
import { useAuthStore } from '@/store/auth.store';
import type { SolicitudPlataforma } from '@/lib/deletion-requests';

const getDeletionRequests = vi.fn();
const previewDeletion = vi.fn();
const approveDeletion = vi.fn();
const rejectDeletion = vi.fn();
const executeDeletion = vi.fn();

vi.mock('@/lib/deletion-requests', async () => {
  const real = await vi.importActual<typeof import('@/lib/deletion-requests')>(
    '@/lib/deletion-requests',
  );
  return {
    ...real,
    getDeletionRequests: (s?: string) => getDeletionRequests(s),
    previewDeletion: (id: string) => previewDeletion(id),
    approveDeletion: (id: string) => approveDeletion(id),
    rejectDeletion: (id: string, r: string) => rejectDeletion(id, r),
    executeDeletion: (id: string, c: string) => executeDeletion(id, c),
  };
});

function solicitud(
  overrides: Partial<SolicitudPlataforma> = {},
): SolicitudPlataforma {
  return {
    id: 'r1',
    companyId: 'c1',
    company: { id: 'c1', name: 'Muebles Ejemplo S.A.S.' },
    status: 'PENDING',
    reason: 'Cierre de la operación',
    requestedAt: '2025-01-01T00:00:00.000Z',
    requestedBy: 'u9',
    approvedAt: null,
    approvedBy: null,
    executedAt: null,
    executedBy: null,
    rejectionReason: null,
    ...overrides,
  };
}

const RESUMEN = {
  mensajes: 12400,
  conversaciones: 310,
  oportunidades: 40,
  tareas: 12,
  cotizaciones: 8,
  contactos: 290,
  automatizaciones: 3,
  flujosChatbot: 1,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeletionRequestsPage />
    </QueryClientProvider>,
  );
}

function comoPlataforma() {
  useAuthStore.setState({
    user: {
      id: 'p1',
      name: 'Plataforma',
      email: 'p@takto.test',
      role: 'SUPER_ADMIN',
      companyId: null,
    } as never,
  });
}

describe('DeletionRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comoPlataforma();
    getDeletionRequests.mockResolvedValue([solicitud()]);
    previewDeletion.mockResolvedValue({
      empresa: { id: 'c1', name: 'Muebles Ejemplo S.A.S.' },
      status: 'PENDING',
      resumen: RESUMEN,
    });
  });

  it('un ADMIN de empresa no entra, aunque sea SUPER_ADMIN con empresa asignada', async () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        name: 'Ana',
        email: 'a@co.test',
        role: 'SUPER_ADMIN',
        companyId: 'c1',
      } as never,
    });
    renderPage();

    expect(
      screen.getByText(/Solo el equipo de plataforma/i),
    ).toBeInTheDocument();
    expect(getDeletionRequests).not.toHaveBeenCalled();
  });

  it('un ADMIN normal tampoco', () => {
    useAuthStore.setState({
      user: {
        id: 'u1',
        name: 'Ana',
        email: 'a@co.test',
        role: 'ADMIN',
        companyId: 'c1',
      } as never,
    });
    renderPage();
    expect(getDeletionRequests).not.toHaveBeenCalled();
  });

  it('sin solicitudes muestra un estado vacío, no una lista en blanco', async () => {
    getDeletionRequests.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(/No hay solicitudes con ese estado/i),
    ).toBeInTheDocument();
  });

  it('avisa cuando la carga falla', async () => {
    getDeletionRequests.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No se pudieron cargar/i,
    );
  });

  it('enseña el recuento de lo que se va a borrar antes de ofrecer nada', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Muebles Ejemplo S.A.S.'));

    expect(await screen.findByText('12.400')).toBeInTheDocument();
    expect(screen.getByText('Mensajes')).toBeInTheDocument();
    expect(screen.getByText(/La ficha de la empresa NO se borra/i)).toBeInTheDocument();
  });

  it('una solicitud pendiente no ofrece ejecutar: primero hay que aprobarla', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Muebles Ejemplo S.A.S.'));

    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /Ejecutar eliminación/i }),
    ).not.toBeInTheDocument();
  });

  it('rechazar exige un motivo', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Muebles Ejemplo S.A.S.'));
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeDisabled();

    await user.type(screen.getByLabelText('Motivo del rechazo'), 'Duplicada');
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeEnabled();
  });

  it('muestra el motivo del servidor cuando quien pidió intenta aprobar', async () => {
    approveDeletion.mockRejectedValue({
      response: {
        data: {
          message:
            'Quien solicita una eliminación no puede aprobarla: hace falta una segunda persona.',
        },
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Muebles Ejemplo S.A.S.'));
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /hace falta una segunda persona/i,
    );
  });

  it('aprobada: ejecutar sigue bloqueado hasta escribir el nombre EXACTO', async () => {
    getDeletionRequests.mockResolvedValue([
      solicitud({ status: 'APPROVED', approvedBy: 'p2' }),
    ]);
    previewDeletion.mockResolvedValue({
      empresa: { id: 'c1', name: 'Muebles Ejemplo S.A.S.' },
      status: 'APPROVED',
      resumen: RESUMEN,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Muebles Ejemplo S.A.S.'));

    const boton = screen.getByRole('button', { name: /Ejecutar eliminación/i });
    expect(boton).toBeDisabled();

    const campo = screen.getByLabelText('Nombre exacto de la empresa');
    await user.type(campo, 'Muebles Ejemplo');
    expect(boton).toBeDisabled();

    await user.type(campo, ' S.A.S.');
    expect(boton).toBeEnabled();
  });

  it('ejecuta con el nombre exacto y cuenta lo eliminado', async () => {
    getDeletionRequests.mockResolvedValue([
      solicitud({ status: 'APPROVED', approvedBy: 'p2' }),
    ]);
    previewDeletion.mockResolvedValue({
      empresa: { id: 'c1', name: 'Muebles Ejemplo S.A.S.' },
      status: 'APPROVED',
      resumen: RESUMEN,
    });
    executeDeletion.mockResolvedValue({ resumen: RESUMEN });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Muebles Ejemplo S.A.S.'));
    await user.type(
      screen.getByLabelText('Nombre exacto de la empresa'),
      'Muebles Ejemplo S.A.S.',
    );
    await user.click(
      screen.getByRole('button', { name: /Ejecutar eliminación/i }),
    );

    await waitFor(() =>
      expect(executeDeletion).toHaveBeenCalledWith(
        'r1',
        'Muebles Ejemplo S.A.S.',
      ),
    );
    expect(
      await screen.findByText(/Eliminados 12.400 mensajes/),
    ).toBeInTheDocument();
  });

  it('no cuenta nada hasta que la fila se abre: contar es caro y borra dudas, no pantallas', async () => {
    renderPage();
    await screen.findByText('Muebles Ejemplo S.A.S.');
    expect(previewDeletion).not.toHaveBeenCalled();
  });
});
