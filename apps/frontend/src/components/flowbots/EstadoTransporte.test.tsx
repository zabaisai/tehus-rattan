import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadoOperativo } from '@/lib/flowbots';
import { useAuthStore } from '@/store/auth.store';
import { EstadoTransporte } from './EstadoTransporte';

const estadoOperativo = vi.fn();

vi.mock('@/lib/flowbots', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/flowbots')>('@/lib/flowbots');
  return {
    ...real,
    flowbots: { ...real.flowbots, estadoOperativo: () => estadoOperativo() },
  };
});

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
      <EstadoTransporte />
    </QueryClientProvider>,
  );
}

describe('Estado del transporte de FlowBot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estadoOperativo.mockResolvedValue(estado());
  });

  it('dice sin rodeos cuando NO se está enviando nada', async () => {
    // Es la información que más caro sale no tener: alguien prueba un bot, ve
    // «enviado» y cree que su cliente ya recibió la respuesta.
    pintar();
    expect(
      await screen.findByText(/no está conectado a WhatsApp/),
    ).toBeInTheDocument();
  });

  it('en modo de prueba lo dice con esas palabras', async () => {
    estadoOperativo.mockResolvedValue(estado({ modo: 'dry-run' }));
    pintar();

    expect(
      await screen.findByText(/no está enviando mensajes reales/),
    ).toBeInTheDocument();
  });

  it('cuando SÍ se envía de verdad, lo avisa', async () => {
    estadoOperativo.mockResolvedValue(
      estado({ modo: 'real', enviaDeVerdad: true }),
    );
    pintar();

    expect(
      await screen.findByText('FlowBot está enviando mensajes reales'),
    ).toBeInTheDocument();
  });

  it('el interruptor de emergencia MANDA sobre el modo', async () => {
    // Da igual estar configurado en real si los envíos están parados: enseñar
    // «enviando mensajes reales» ahí sería mentira.
    estadoOperativo.mockResolvedValue(
      estado({
        modo: 'real',
        enviaDeVerdad: false,
        killSwitch: {
          activo: true,
          motivo: 'incidente con un cliente',
          activadoEn: '2026-08-04T10:00:00.000Z',
          activadoPor: 'Camila Ruiz',
        },
      }),
    );
    pintar();

    expect(await screen.findByText('Envíos parados')).toBeInTheDocument();
    expect(
      screen.getByText(/incidente con un cliente · Camila Ruiz/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/enviando mensajes reales/)).toBeNull();
  });

  it('a un AGENT no se le enseña: no es una decisión suya', async () => {
    pintar('AGENT');
    // Se espera a que la consulta pueda haber resuelto y aun así no hay nada.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('si el estado no se puede leer, no rompe la pantalla', async () => {
    // Este indicador va encima del editor: un fallo suyo no puede impedir
    // trabajar.
    estadoOperativo.mockRejectedValue(new Error('sin conexión'));
    pintar();

    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('se anuncia como `status`, no como `alert`', async () => {
    // Un `alert` en cada carga interrumpiría la lectura con lector de pantalla
    // cada vez que alguien abre el editor.
    pintar();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
