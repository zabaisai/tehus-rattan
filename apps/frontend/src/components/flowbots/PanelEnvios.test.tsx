import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadoOperativo } from '@/lib/flowbots';
import { useAuthStore } from '@/store/auth.store';
import { PanelEnvios } from './PanelEnvios';

const estadoOperativo = vi.fn();
const reiniciarBreaker = vi.fn();

vi.mock('@/lib/flowbots', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/flowbots')>('@/lib/flowbots');
  return {
    ...real,
    flowbots: {
      ...real.flowbots,
      estadoOperativo: () => estadoOperativo(),
      reiniciarBreaker: (id: string, m: string) => reiniciarBreaker(id, m),
    },
  };
});

function breaker(parcial = {}) {
  return {
    estado: 'CLOSED' as const,
    fallosConsecutivos: 0,
    abiertoEn: null,
    proximoIntento: null,
    ultimaCausa: null,
    ultimoExito: null,
    aperturas: 0,
    ...parcial,
  };
}

function estado(parcial: Partial<EstadoOperativo> = {}): EstadoOperativo {
  return {
    modo: 'falso',
    etiqueta: 'x',
    enviaDeVerdad: false,
    killSwitch: {
      activo: false,
      motivo: null,
      activadoEn: null,
      activadoPor: null,
    },
    contador: {
      disponible: true,
      limites: [{ dimension: 'empresa', minuto: 30, hora: 300, dia: 2000 }],
    },
    numeros: [
      {
        integrationId: 'i1',
        etiqueta: 'Ventas',
        estadoIntegracion: 'CONNECTED',
        breaker: breaker(),
      },
    ],
    ejecucionesEnAtencion: 0,
    ...parcial,
  };
}

function pintar(rol: 'ADMIN' | 'MANAGER' | 'AGENT' = 'ADMIN') {
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
      <PanelEnvios />
    </QueryClientProvider>,
  );
}

describe('Panel de estado de los envíos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estadoOperativo.mockResolvedValue(estado());
  });

  it('enseña el estado de cada número', async () => {
    pintar();
    expect(await screen.findByText('Ventas')).toBeInTheDocument();
    expect(screen.getByText('Enviando')).toBeInTheDocument();
  });

  it('un número en pausa se ve, con la causa y cuándo reintenta', async () => {
    // Sin esto, «el bot no contesta» obliga a abrir registros del servidor.
    estadoOperativo.mockResolvedValue(
      estado({
        numeros: [
          {
            integrationId: 'i1',
            etiqueta: 'Ventas',
            estadoIntegracion: 'CONNECTED',
            breaker: breaker({
              estado: 'OPEN',
              ultimaCausa: 'meta-caido',
              proximoIntento: '2026-08-05T10:30:00.000Z',
            }),
          },
        ],
      }),
    );
    pintar();

    expect(await screen.findByText('En pausa')).toBeInTheDocument();
    expect(screen.getByText('meta-caido')).toBeInTheDocument();
    expect(screen.getByText(/reintenta/)).toBeInTheDocument();
  });

  it('el contador caído se explica por lo que IMPLICA', async () => {
    // «Redis no responde» no le dice nada a quien administra una empresa.
    estadoOperativo.mockResolvedValue(
      estado({ contador: { disponible: false, limites: [] } }),
    );
    pintar();

    expect(
      await screen.findByText(/envíos reales están bloqueados/),
    ).toBeInTheDocument();
  });

  it('reiniciar EXPLICA lo que no hace', async () => {
    // Quien lo pulse esperando desbloquear un envío que el interruptor impide
    // no lo va a conseguir, y tiene que saberlo antes.
    estadoOperativo.mockResolvedValue(
      estado({
        numeros: [
          {
            integrationId: 'i1',
            etiqueta: 'Ventas',
            estadoIntegracion: 'CONNECTED',
            breaker: breaker({ estado: 'OPEN' }),
          },
        ],
      }),
    );
    pintar();

    await userEvent.click(
      await screen.findByRole('button', { name: /Reintentar ya/ }),
    );

    expect(
      screen.getByText(/interruptor de emergencia está activo/),
    ).toBeInTheDocument();
    expect(reiniciarBreaker).not.toHaveBeenCalled();
  });

  it('reiniciar EXIGE un motivo escrito', async () => {
    estadoOperativo.mockResolvedValue(
      estado({
        numeros: [
          {
            integrationId: 'i1',
            etiqueta: 'Ventas',
            estadoIntegracion: 'CONNECTED',
            breaker: breaker({ estado: 'OPEN' }),
          },
        ],
      }),
    );
    pintar();

    await userEvent.click(
      await screen.findByRole('button', { name: /Reintentar ya/ }),
    );
    const confirmar = screen.getByRole('button', { name: 'Reintentar' });
    expect(confirmar).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'el número ya responde');
    expect(confirmar).toBeEnabled();

    await userEvent.click(confirmar);
    expect(reiniciarBreaker).toHaveBeenCalledWith(
      'i1',
      'el número ya responde',
    );
  });

  it('un MANAGER ve el estado pero NO puede reiniciar', async () => {
    // Reiniciar afecta a los envíos de toda la empresa; verlo, no.
    estadoOperativo.mockResolvedValue(
      estado({
        numeros: [
          {
            integrationId: 'i1',
            etiqueta: 'Ventas',
            estadoIntegracion: 'CONNECTED',
            breaker: breaker({ estado: 'OPEN' }),
          },
        ],
      }),
    );
    pintar('MANAGER');

    expect(await screen.findByText('En pausa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reintentar ya/ })).toBeNull();
  });

  it('a un AGENT no se le pinta nada', async () => {
    pintar('AGENT');
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText('Estado de los envíos')).toBeNull();
  });

  it('varios números en pausa apuntan a una causa común', async () => {
    estadoOperativo.mockResolvedValue(
      estado({
        numeros: [
          {
            integrationId: 'i1',
            etiqueta: 'Ventas',
            estadoIntegracion: 'CONNECTED',
            breaker: breaker({ estado: 'OPEN' }),
          },
          {
            integrationId: 'i2',
            etiqueta: 'Soporte',
            estadoIntegracion: 'CONNECTED',
            breaker: breaker({ estado: 'OPEN' }),
          },
        ],
      }),
    );
    pintar();

    expect(
      await screen.findByText(/problema común, no de cada número/),
    ).toBeInTheDocument();
  });

  it('los límites configurados se pueden consultar', async () => {
    pintar();
    expect(await screen.findByText(/Límites de envío/)).toBeInTheDocument();
    expect(screen.getByText('empresa')).toBeInTheDocument();
  });
});
