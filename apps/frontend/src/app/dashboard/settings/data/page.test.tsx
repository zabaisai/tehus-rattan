import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataSettingsPage from './page';
import { useAuthStore } from '@/store/auth.store';

const getRetention = vi.fn();
const setRetentionMock = vi.fn();
const previewPurge = vi.fn();
const purgeMock = vi.fn();
const exportCompanyData = vi.fn();
const requestDeletion = vi.fn();
const getDeletionRequests = vi.fn();
const descargarExportacion = vi.fn();

vi.mock('@/lib/compliance', async () => {
  const real = await vi.importActual<typeof import('@/lib/compliance')>(
    '@/lib/compliance',
  );
  return {
    ...real,
    getRetention: () => getRetention(),
    setRetention: (c: unknown) => setRetentionMock(c),
    previewPurge: () => previewPurge(),
    purge: () => purgeMock(),
    exportCompanyData: () => exportCompanyData(),
    requestDeletion: (r: string) => requestDeletion(r),
    getDeletionRequests: () => getDeletionRequests(),
    descargarExportacion: (...a: unknown[]) => descargarExportacion(...a),
  };
});

vi.mock('@/lib/companies', () => ({
  getMyCompany: () => Promise.resolve({ id: 'c1', name: 'Empresa A' }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DataSettingsPage />
    </QueryClientProvider>,
  );
}

function comoAdmin() {
  useAuthStore.setState({
    user: {
      id: 'u1',
      name: 'Ana',
      email: 'a@co.test',
      role: 'ADMIN',
      companyId: 'c1',
    } as never,
  });
}

describe('DataSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comoAdmin();
    getRetention.mockResolvedValue({
      retentionMonths: null,
      retentionPurgeEnabled: false,
    });
    previewPurge.mockResolvedValue({
      aplicable: false,
      motivo: 'sin-politica',
      mensajes: 0,
    });
    getDeletionRequests.mockResolvedValue([]);
    setRetentionMock.mockResolvedValue({
      retentionMonths: 12,
      retentionPurgeEnabled: false,
    });
  });

  it('un AGENT no ve nada de esto: exportar es una copia de los datos de todos los clientes', async () => {
    useAuthStore.setState({
      user: {
        id: 'u2',
        name: 'Agente',
        email: 'ag@co.test',
        role: 'AGENT',
        companyId: 'c1',
      } as never,
    });
    renderPage();

    expect(
      screen.getByText(/No tienes permiso para administrar los datos/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Descargar mis datos/i }),
    ).not.toBeInTheDocument();
    expect(getRetention).not.toHaveBeenCalled();
  });

  it('sin política dice que no se borraría nada, en vez de dejar el hueco vacío', async () => {
    renderPage();
    expect(
      await screen.findByText(/no se borraría ningún mensaje/i),
    ).toBeInTheDocument();
  });

  it('rechaza un plazo por debajo del mínimo sin llamar al servidor', async () => {
    const user = userEvent.setup();
    renderPage();

    const campo = await screen.findByLabelText('Meses de retención');
    await user.type(campo, '3');
    await user.click(screen.getByRole('button', { name: /Guardar plazo/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /mínimo es de 6 meses/i,
    );
    expect(setRetentionMock).not.toHaveBeenCalled();
  });

  it('un campo vacío se guarda como null: es "no borrar nunca", no "sin cambios"', async () => {
    getRetention.mockResolvedValue({
      retentionMonths: 12,
      retentionPurgeEnabled: false,
    });
    const user = userEvent.setup();
    renderPage();

    const campo = await screen.findByLabelText('Meses de retención');
    await waitFor(() => expect(campo).toHaveValue('12'));
    await user.clear(campo);
    await user.click(screen.getByRole('button', { name: /Guardar plazo/i }));

    await waitFor(() =>
      expect(setRetentionMock).toHaveBeenCalledWith({ retentionMonths: null }),
    );
  });

  it('no deja purgar mientras la purga no esté activada, aunque haya mensajes que cumplan el plazo', async () => {
    previewPurge.mockResolvedValue({
      aplicable: true,
      corte: '2024-01-01T00:00:00.000Z',
      purgaActivada: false,
      mensajes: 1200,
    });
    renderPage();

    const boton = await screen.findByRole('button', { name: /Purgar ahora/i });
    expect(boton).toBeDisabled();
    expect(screen.getByText(/1.200 mensajes/)).toBeInTheDocument();
  });

  it('purga cuando las dos señales están puestas y cuenta lo eliminado', async () => {
    previewPurge.mockResolvedValue({
      aplicable: true,
      corte: '2024-01-01T00:00:00.000Z',
      purgaActivada: true,
      mensajes: 1200,
    });
    purgeMock.mockResolvedValue({
      mensajesEliminados: 1200,
      corte: '2024-01-01T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Purgar ahora/i }));

    await waitFor(() => expect(purgeMock).toHaveBeenCalled());
    expect(
      await screen.findByText(/Se eliminaron 1.200 mensajes/),
    ).toBeInTheDocument();
  });

  it('muestra el motivo real del servidor cuando rechaza la purga', async () => {
    previewPurge.mockResolvedValue({
      aplicable: true,
      corte: '2024-01-01T00:00:00.000Z',
      purgaActivada: true,
      mensajes: 5,
    });
    purgeMock.mockRejectedValue({
      response: {
        data: {
          message:
            'La purga requiere un plazo de retención definido y activado explícitamente.',
        },
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Purgar ahora/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /activado explícitamente/i,
    );
  });

  it('exporta y descarga el fichero', async () => {
    exportCompanyData.mockResolvedValue({ contactos: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /Descargar mis datos/i }),
    );

    await waitFor(() => expect(exportCompanyData).toHaveBeenCalled());
    expect(descargarExportacion).toHaveBeenCalledWith(
      { contactos: [] },
      'Empresa A',
    );
  });

  it('exige un motivo antes de dejar solicitar la eliminación', async () => {
    const user = userEvent.setup();
    renderPage();

    const campo = await screen.findByLabelText('Motivo de la eliminación');
    await user.type(campo, 'corto');
    await user.click(
      screen.getByRole('button', { name: /Solicitar eliminación/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /al menos 10 caracteres/i,
    );
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('con una solicitud en curso no ofrece pedir otra', async () => {
    getDeletionRequests.mockResolvedValue([
      {
        id: 'r1',
        status: 'PENDING',
        reason: 'Cierre de la empresa',
        requestedAt: '2025-01-01T00:00:00.000Z',
        rejectionReason: null,
      },
    ]);
    renderPage();

    expect(
      await screen.findByText(/Ya hay una solicitud en curso/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Solicitar eliminación/i }),
    ).not.toBeInTheDocument();
  });

  it('deja claro que solicitar no borra nada todavía', async () => {
    renderPage();
    expect(
      await screen.findByText(/Esto no borra nada ahora/i),
    ).toBeInTheDocument();
  });
});
