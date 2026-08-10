import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BotResumen } from '@/lib/flowbots';
import { useAuthStore } from '@/store/auth.store';
import FlowBotsPage from './page';

const listar = vi.fn();
const cambiarEstado = vi.fn();
const duplicar = vi.fn();

vi.mock('@/lib/flowbots', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/flowbots')>('@/lib/flowbots');
  return {
    ...real,
    flowbots: {
      ...real.flowbots,
      listar: (f: unknown) => listar(f),
      cambiarEstado: (id: string, e: string) => cambiarEstado(id, e),
      duplicar: (id: string) => duplicar(id),
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function bot(parcial: Partial<BotResumen> = {}): BotResumen {
  return {
    id: 'b1',
    nombre: 'Atención de primer contacto',
    descripcion: 'Contesta al primer mensaje',
    estado: 'ACTIVE',
    esPlantilla: false,
    versionPublicada: 3,
    publishedVersionId: 'v3',
    draftRevision: 4,
    disparadores: [],
    metricas: {
      ejecucionesTotales: 120,
      ultimaEjecucionEn: '2026-08-01T10:00:00.000Z',
      tasaFinalizacion: 0.75,
      handoffs: 8,
      errores: 0,
      necesitanAtencion: 0,
    },
    creadoEn: '2026-07-01T10:00:00.000Z',
    actualizadoEn: '2026-08-01T10:00:00.000Z',
    actualizadoPor: 'Camilo',
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
      <FlowBotsPage />
    </QueryClientProvider>,
  );
}

describe('Pantalla de FlowBot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listar.mockResolvedValue([bot()]);
  });

  it('sin bots invita a empezar por una plantilla', async () => {
    listar.mockResolvedValue([]);
    pintar();

    expect(
      await screen.findByText(/Todavía no hay bots/),
    ).toBeInTheDocument();
  });

  it('un fallo del servidor NO se confunde con «no tienes bots»', async () => {
    // Es la peor confusión posible: en un caso hay que crear algo y en el otro
    // hay que avisar de que no se está viendo lo que sí existe.
    listar.mockRejectedValue(new Error('caído'));
    pintar();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay bots/)).not.toBeInTheDocument();
  });

  it('un bot activo que está fallando se marca «Con errores», no «Activo»', async () => {
    // Un bot encendido que falla es el que hay que abrir primero; llamarlo
    // «activo» lo esconde entre los que van bien.
    listar.mockResolvedValue([
      bot({
        estado: 'ACTIVE',
        metricas: { ...bot().metricas, errores: 4 },
      }),
    ]);
    pintar();

    expect(await screen.findByText('Con errores')).toBeInTheDocument();
  });

  it('un bot apagado que ya se publicó se llama «Inactivo», no «Borrador»', async () => {
    listar.mockResolvedValue([bot({ estado: 'DRAFT', versionPublicada: 2 })]);
    pintar();

    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
  });

  it('un bot que nunca se publicó sí es un borrador', async () => {
    listar.mockResolvedValue([bot({ estado: 'DRAFT', versionPublicada: null })]);
    pintar();

    expect(await screen.findByText('Borrador')).toBeInTheDocument();
  });

  it('no se puede activar un bot sin versión publicada', async () => {
    // El selector solo mira los que tienen versión: el botón sin ella
    // prometería algo que no va a pasar.
    listar.mockResolvedValue([
      bot({ estado: 'DRAFT', versionPublicada: null }),
    ]);
    pintar();

    const activar = await screen.findByRole('button', { name: /Activar/ });
    expect(activar).toBeDisabled();
  });

  /**
   * ACTIVAR NO ES UNA PRUEBA INOCUA.
   *
   * El interruptor de emergencia solo detiene los envios de WhatsApp. Un bot
   * activo sigue creando oportunidades, moviendo etapas, asignando y creando
   * tareas: el adaptador de CRM no consulta el interruptor en ningun punto.
   * Presentarlo como si no pasara nada es lo que hace que alguien lo pulse «a
   * ver que hace» sobre datos reales.
   */
  it('activar pide confirmacion y explica que hay efectos en el CRM', async () => {
    const usuario = userEvent.setup();
    listar.mockResolvedValue([
      bot({ estado: 'DRAFT', versionPublicada: 1 }),
    ]);
    pintar();

    await usuario.click(await screen.findByRole('button', { name: /Activar/ }));

    expect(
      await screen.findByText(/puede ejecutar acciones en el CRM/i),
    ).toBeInTheDocument();
    // NO se promete que sea una simulacion, porque no lo es.
    expect(screen.queryByText(/es una simulación/i)).toBeNull();
    // Y se dice que WhatsApp sigue bloqueado, sin insinuar que eso lo cubra todo.
    expect(
      screen.getByText(/mensajes reales de WhatsApp continúan bloqueados/i),
    ).toBeInTheDocument();
    // Nada ha cambiado todavia: la confirmacion no se ha aceptado.
    expect(cambiarEstado).not.toHaveBeenCalled();
  });

  it('el bot solo se activa tras confirmar', async () => {
    const usuario = userEvent.setup();
    listar.mockResolvedValue([
      bot({ estado: 'DRAFT', versionPublicada: 1 }),
    ]);
    pintar();

    await usuario.click(await screen.findByRole('button', { name: /Activar/ }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(
      within(dialogo).getByRole('button', { name: /^Activar$/ }),
    );

    expect(cambiarEstado).toHaveBeenCalledWith(expect.any(String), 'ACTIVE');
  });

  it('un AGENT no ve crear, editar ni archivar', async () => {
    pintar('AGENT');
    await screen.findByText('Atención de primer contacto');

    expect(screen.queryByRole('link', { name: /Nuevo bot/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pausar/ })).toBeNull();
  });

  it('un MANAGER puede pausar pero no archivar', async () => {
    pintar('MANAGER');
    await screen.findByText('Atención de primer contacto');

    expect(screen.getByRole('button', { name: /Pausar/ })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Acciones de/ }),
    );
    expect(screen.queryByRole('menuitem', { name: /Archivar/ })).toBeNull();
  });

  it('archivar explica qué pasa con lo que ya está en marcha', async () => {
    pintar('ADMIN');
    await screen.findByText('Atención de primer contacto');

    await userEvent.click(screen.getByRole('button', { name: /Acciones de/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Archivar/ }));

    // Archivar sin avisar deja a alguien esperando una respuesta que no llega.
    expect(
      screen.getByText(/Las que ya empezaron siguen su curso/),
    ).toBeInTheDocument();
  });

  it('buscar filtra sin volver a pedir al servidor', async () => {
    listar.mockResolvedValue([
      bot({ id: 'b1', nombre: 'Primer contacto' }),
      bot({ id: 'b2', nombre: 'Recordatorio de cita' }),
    ]);
    pintar();
    await screen.findByText('Primer contacto');

    const llamadasAntes = listar.mock.calls.length;
    await userEvent.type(screen.getByLabelText('Buscar bots'), 'recordatorio');

    expect(screen.getByText('Recordatorio de cita')).toBeInTheDocument();
    expect(screen.queryByText('Primer contacto')).toBeNull();
    expect(listar.mock.calls.length).toBe(llamadasAntes);
  });

  it('los archivados no se mezclan con los vivos', async () => {
    listar.mockResolvedValue([
      bot({ id: 'b1', nombre: 'Vivo' }),
      bot({ id: 'b2', nombre: 'Retirado', estado: 'ARCHIVED' }),
    ]);
    pintar();

    expect(await screen.findByText('Vivo')).toBeInTheDocument();
    expect(screen.queryByText('Retirado')).toBeNull();
  });

  it('el filtro de archivados enseña solo esos', async () => {
    listar.mockResolvedValue([
      bot({ id: 'b1', nombre: 'Vivo' }),
      bot({ id: 'b2', nombre: 'Retirado', estado: 'ARCHIVED' }),
    ]);
    pintar();
    await screen.findByText('Vivo');

    await userEvent.click(screen.getByRole('tab', { name: 'Archivados' }));

    expect(await screen.findByText('Retirado')).toBeInTheDocument();
    expect(screen.queryByText('Vivo')).toBeNull();
  });

  it('un fallo al pausar se dice; no se queda en silencio', async () => {
    // Sin esto, la promesa se rechaza, la lista no cambia y queda la impresión
    // de que el bot está pausado cuando sigue contestando.
    cambiarEstado.mockRejectedValue(new Error('no se pudo'));
    pintar();
    await screen.findByText('Atención de primer contacto');

    await userEvent.click(screen.getByRole('button', { name: /Pausar/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo/i);
  });
});
