import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadoOperativo } from '@/lib/flowbots';
import { useAuthStore } from '@/store/auth.store';
import { EstadoTransporte } from './EstadoTransporte';
import { NOMBRE_PULSO } from '@/lib/producto';

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

/** Interruptor apagado, para los casos que no lo ejercitan. */
const SIN_INTERRUPTOR = {
  activo: false,
  motivo: null,
  activadoEn: null,
  activadoPor: null,
};

describe('Estado del transporte de Pulso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estadoOperativo.mockResolvedValue(estado());
  });

  /**
   * REDACCION CAMBIADA A PROPOSITO.
   *
   * Antes el interruptor pintaba SIEMPRE una alerta roja «Envios parados», y
   * en staging convivia con una etiqueta verde «Enviando» sobre el numero. Un
   * entorno protegido no es un incidente: anunciarlo en rojo entrena a la gente
   * a ignorar las alertas rojas de verdad.
   *
   * Ahora el rojo se reserva para la unica combinacion que lo merece —modo real
   * con el interruptor activo— y el resto se comunica por lo que es.
   */
  it('en modo seguro lo dice sin alarmar', async () => {
    pintar();
    expect(await screen.findByText('Modo seguro de pruebas')).toBeInTheDocument();
    expect(
      screen.getByText(/envíos reales de WhatsApp están desactivados/i),
    ).toBeInTheDocument();
    // Y nunca la palabra que causaba la contradiccion.
    expect(screen.queryByText(/Enviando/)).toBeNull();
  });

  it('en modo de prueba lo dice con esas palabras', async () => {
    estadoOperativo.mockResolvedValue(
      estado({ modo: 'dry-run', killSwitch: SIN_INTERRUPTOR }),
    );
    pintar();

    expect(await screen.findByText('Modo de simulación')).toBeInTheDocument();
    expect(screen.getByText(/no sale nada hacia WhatsApp/i)).toBeInTheDocument();
  });

  it('cuando SÍ se puede enviar, lo avisa', async () => {
    estadoOperativo.mockResolvedValue(
      estado({ modo: 'real', enviaDeVerdad: true, killSwitch: SIN_INTERRUPTOR }),
    );
    pintar();

    // «Habilitados» y no «Enviando»: lo que se sabe es que se permite, no que
    // este ocurriendo algo en este instante.
    expect(await screen.findByText('Envíos habilitados')).toBeInTheDocument();
    expect(screen.queryByText(/Enviando/)).toBeNull();
  });

  it('el interruptor MANDA sobre el modo real, y ahí sí es una alarma', async () => {
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

    expect(
      await screen.findByText('Envíos detenidos por seguridad'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/enviando mensajes reales/)).toBeNull();
    // El motivo tecnico va en el detalle desplegable, no en el mensaje.
    expect(
      screen.getByText(/incidente con un cliente/),
    ).toBeInTheDocument();
  });

  it('el motivo con un SHA antiguo no se presenta como release actual', async () => {
    estadoOperativo.mockResolvedValue(
      estado({
        killSwitch: {
          activo: true,
          motivo: 'Activado en el despliegue a staging de 347b957.',
          activadoEn: '2026-08-05T19:38:05.199Z',
          activadoPor: null,
        },
      }),
    );
    pintar();

    // El mensaje principal no lo menciona...
    expect(await screen.findByText('Modo seguro de pruebas')).toBeInTheDocument();
    // ...y donde aparece, se etiqueta como historico.
    expect(screen.getByText(/Detalle técnico del interruptor/)).toBeInTheDocument();
    expect(
      screen.getByText(/No indica la versión desplegada ahora/),
    ).toBeInTheDocument();
  });

  it('el estado no depende solo del color: siempre hay texto', async () => {
    pintar();
    const aviso = await screen.findByRole('status');
    expect(aviso.textContent?.trim().length).toBeGreaterThan(20);
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
