import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EjecucionDetalle } from '@/lib/flowbots';
import { useAuthStore } from '@/store/auth.store';
import DetalleEjecucionPage from './page';

const ejecucion = vi.fn();
const cancelarEjecucion = vi.fn();
const reintentarEjecucion = vi.fn();
const forzarHandoff = vi.fn();

vi.mock('@/lib/flowbots', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/flowbots')>('@/lib/flowbots');
  return {
    ...real,
    flowbots: {
      ...real.flowbots,
      ejecucion: (id: string) => ejecucion(id),
      cancelarEjecucion: (id: string, m: string) => cancelarEjecucion(id, m),
      pausarEjecucion: vi.fn(),
      reanudarEjecucion: vi.fn(),
      reintentarEjecucion: (id: string) => reintentarEjecucion(id),
      forzarHandoff: (id: string, d: unknown) => forzarHandoff(id, d),
    },
  };
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ executionId: 'ex1' }),
}));

function detalle(parcial: Partial<EjecucionDetalle> = {}): EjecucionDetalle {
  return {
    id: 'ex1',
    estado: 'WAITING_INPUT',
    botId: 'b1',
    botNombre: 'Primer contacto',
    versionId: 'v1',
    version: 2,
    correlationId: 'corr-1',
    conversationId: 'cv1',
    contactId: 'ct1',
    contacto: 'Ana Pérez',
    leadId: null,
    asignadoA: null,
    whatsappIntegrationId: null,
    pasos: 4,
    errorCode: null,
    motivoFin: null,
    necesitaAtencion: false,
    hayHandoff: false,
    iniciadaEn: '2026-08-01T10:00:00.000Z',
    terminadaEn: null,
    duracionMs: null,
    variables: { 'contact.name': 'Ana Pérez' },
    pasos_detalle: [
      {
        id: 'p1',
        nodeId: 'inicio',
        nodeType: 'trigger.inbound_message',
        estado: 'OK',
        puertoSalida: 'next',
        errorCode: null,
        duracionMs: 12,
        intento: 1,
        meta: null,
        en: '2026-08-01T10:00:01.000Z',
      },
    ],
    esperas: [],
    handoff: null,
    efectos: [],
    ...parcial,
  };
}

function pintar(rol: 'ADMIN' | 'AGENT' = 'ADMIN') {
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'a@b.test',
      name: 'Quien sea',
      role: rol,
      companyId: 'c1',
    },
    status: 'authenticated',
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DetalleEjecucionPage />
    </QueryClientProvider>,
  );
}

describe('Detalle de una ejecución', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ejecucion.mockResolvedValue(detalle());
  });

  it('enseña por dónde pasó, no solo el estado final', async () => {
    pintar();
    expect(await screen.findByText('inicio')).toBeInTheDocument();
    expect(screen.getByText('trigger.inbound_message')).toBeInTheDocument();
  });

  it('cancelar explica qué pasa ANTES de hacerlo', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Pérez' });

    await userEvent.click(screen.getByRole('button', { name: /Cancelar$/ }));

    // «¿Seguro?» no informa de nada y la respuesta siempre es que sí.
    expect(
      screen.getByText(/Lo que ya se envió no se puede deshacer/),
    ).toBeInTheDocument();
    expect(cancelarEjecucion).not.toHaveBeenCalled();
  });

  it('cancelar exige un motivo escrito', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Pérez' });
    await userEvent.click(screen.getByRole('button', { name: /Cancelar$/ }));

    const confirmar = screen.getByRole('button', {
      name: 'Cancelar la ejecución',
    });
    expect(confirmar).toBeDisabled();

    await userEvent.type(
      screen.getByRole('textbox'),
      'el cliente pidió que paráramos',
    );
    expect(confirmar).toBeEnabled();

    await userEvent.click(confirmar);
    expect(cancelarEjecucion).toHaveBeenCalledWith(
      'ex1',
      'el cliente pidió que paráramos',
    );
  });

  it('una ejecución que necesita revisión lo dice y ofrece reintentar', async () => {
    ejecucion.mockResolvedValue(
      detalle({ estado: 'NEEDS_ATTENTION', necesitaAtencion: true }),
    );
    pintar();

    expect(
      await screen.findByText(/no se sabe si el último paso llegó a hacerse/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Reintentar/ }),
    ).toBeInTheDocument();
  });

  it('una ejecución terminada no ofrece cancelar ni pausar', async () => {
    ejecucion.mockResolvedValue(
      detalle({ estado: 'COMPLETED', terminadaEn: '2026-08-01T10:05:00.000Z' }),
    );
    pintar();
    await screen.findByRole('heading', { name: 'Ana Pérez' });

    expect(screen.queryByRole('button', { name: /Cancelar$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pausar/ })).toBeNull();
  });

  it('un AGENT no ve las acciones que no puede hacer', async () => {
    pintar('AGENT');
    await screen.findByRole('heading', { name: 'Ana Pérez' });

    expect(screen.queryByRole('button', { name: /Cancelar$/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Pasar a una persona/ }),
    ).toBeNull();
  });

  it('un fallo al intervenir se dice, no se traga', async () => {
    cancelarEjecucion.mockRejectedValue(new Error('no se pudo'));
    pintar();
    await screen.findByRole('heading', { name: 'Ana Pérez' });

    await userEvent.click(screen.getByRole('button', { name: /Cancelar$/ }));
    await userEvent.type(screen.getByRole('textbox'), 'porque sí');
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancelar la ejecución' }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('enseña el correlationId para poder seguir el rastro', async () => {
    // Es lo que une esta pantalla con los registros del servidor cuando hay
    // que averiguar qué pasó de verdad.
    pintar();
    expect(await screen.findByText(/corr-1/)).toBeInTheDocument();
  });
});
