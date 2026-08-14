import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FusionDeDuplicados } from './FusionDeDuplicados';

/**
 * REENTRADA Y RESPUESTAS OBSOLETAS.
 *
 * La segunda prueba humana pulsó UNA vez «Sí, fusionar contactos», vio un
 * conflicto —«otra persona completó una fusión…»— y, tras pulsar «Volver a
 * comparar», apareció una pantalla de éxito. Es la firma de dos cosas que
 * pueden ocurrir a la vez: más de una petición por gesto, y una respuesta que
 * llega tarde y pisa el estado que ya había puesto otra.
 *
 * `setState` no sirve de candado: dos eventos en el mismo fotograma leen el
 * mismo valor de `enviando` antes de que React vuelva a renderizar. El candado
 * tiene que ser síncrono.
 *
 * Ids ficticios; ninguna escritura.
 */

const ejecutarFusion = vi.fn();
const compararContactos = vi.fn();
const getCandidatos = vi.fn();
const deshacerFusion = vi.fn();
const descartarDuplicado = vi.fn();

vi.mock('@/lib/fusion', async () => {
  const real = await vi.importActual<typeof import('@/lib/fusion')>('@/lib/fusion');
  return {
    ...real,
    getCandidatos: (id: string) => getCandidatos(id),
    compararContactos: (p: string, d: string) => compararContactos(p, d),
    ejecutarFusion: (x: unknown) => ejecutarFusion(x),
    deshacerFusion: (id: string) => deshacerFusion(id),
    descartarDuplicado: (a: string, b: string) => descartarDuplicado(a, b),
  };
});
vi.mock('@/lib/contacts', async () => {
  const real = await vi.importActual<typeof import('@/lib/contacts')>('@/lib/contacts');
  return { ...real, getContacts: () => Promise.resolve([]) };
});

const P = 'principal-1';
const D = 'duplicado-1';

function contacto(id: string) {
  return {
    id,
    name: id === P ? 'QA Principal' : 'QA Duplicado',
    phone: id === P ? '+573001110001' : '+573001110002',
    email: `${id}@example.invalid`,
    tags: [],
    altPhones: [],
    altEmails: [],
    archivedAt: null,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:00.000Z',
    mergedIntoId: null,
  };
}

const RECUENTO = {
  conversaciones: 1,
  mensajes: 3,
  oportunidades: 1,
  tareas: 1,
  sugerenciasDeTarea: 0,
  cotizaciones: 1,
  camposPersonalizados: 1,
  ejecucionesDeBot: 0,
  notas: 1,
};

function vista(principalId: string, duplicadoId: string) {
  return {
    principal: contacto(principalId),
    duplicado: contacto(duplicadoId),
    coincidencia: { nivel: 'alta' as const, razones: ['Mismo teléfono'] },
    campos: [],
    camposPersonalizados: [],
    etiquetas: { principal: [], duplicado: [], union: [] },
    identidadesAlternativas: { telefonos: [], correos: [] },
    relaciones: RECUENTO,
    versiones: { principal: `v-${principalId}`, duplicado: `v-${duplicadoId}` },
    decisionesPendientes: 0,
  };
}

const EXITO = {
  mergeId: 'm1',
  principalId: P,
  duplicadoId: D,
  trasladadas: RECUENTO,
  totalConservado: RECUENTO,
  realizadaEn: '2026-08-14T12:00:00.000Z',
  deshacerHasta: new Date(Date.now() + 9 * 60_000).toISOString(),
  segundosRestantes: 540,
  deshecha: false,
};

const CONFLICTO = {
  response: { status: 409, data: { codigo: 'FUSION_CONCURRENTE' } },
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Padre() {
    const [sel, setSel] = useState({ principalId: P, duplicadoId: D as string | null });
    return (
      <FusionDeDuplicados
        contactoId={sel.principalId}
        duplicadoInicialId={sel.duplicadoId}
        pasoInicial="comparar"
        puedeEjecutar
        onCerrar={vi.fn()}
        onFusionado={vi.fn()}
        onCambioDeSeleccion={(s) =>
          setSel({ principalId: s.principalId, duplicadoId: s.duplicadoId })
        }
      />
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <Padre />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCandidatos.mockResolvedValue([]);
  compararContactos.mockImplementation((p: string, d: string) =>
    Promise.resolve(vista(p, d)),
  );
  ejecutarFusion.mockResolvedValue(EXITO);
});

/** Lleva hasta el paso de confirmar con la casilla marcada. */
async function hastaConfirmar(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Todo esto se conservará');
  await user.click(screen.getByRole('button', { name: 'Resolver diferencias' }));
  await user.click(
    await screen.findByRole('button', { name: 'Continuar a confirmación' }),
  );
  await user.click(await screen.findByRole('checkbox', { name: /misma persona/ }));
  return screen.getByRole('button', { name: 'Sí, fusionar contactos' });
}

describe('Fusión — un gesto, una petición', () => {
  it('un solo clic produce exactamente un POST de fusión', async () => {
    const user = userEvent.setup();
    montar();
    const boton = await hastaConfirmar(user);

    await user.click(boton);

    await waitFor(() => expect(ejecutarFusion).toHaveBeenCalledTimes(1));
  });

  it('dos eventos en el mismo fotograma tampoco producen dos POST', async () => {
    // `setState` no bloquea: los dos manejadores leen el mismo `enviando`
    // antes de que React vuelva a renderizar. Se dispara el `click` nativo dos
    // veces seguidas, sin ceder el hilo, que es lo que hace un doble clic.
    const user = userEvent.setup();
    montar();
    const boton = await hastaConfirmar(user);

    boton.click();
    boton.click();

    await waitFor(() => expect(ejecutarFusion).toHaveBeenCalled());
    expect(ejecutarFusion).toHaveBeenCalledTimes(1);
  });

  it('el principal que se envía es el que se está mostrando', async () => {
    const user = userEvent.setup();
    montar();
    const boton = await hastaConfirmar(user);
    await user.click(boton);

    await waitFor(() => expect(ejecutarFusion).toHaveBeenCalled());
    expect(ejecutarFusion.mock.calls[0][0]).toMatchObject({
      principalId: P,
      duplicadoId: D,
    });
  });
});

describe('Fusión — respuestas obsoletas y «Volver a comparar»', () => {
  it('«Volver a comparar» no ejecuta ninguna fusión y regresa a comparar', async () => {
    ejecutarFusion.mockRejectedValue(CONFLICTO);
    const user = userEvent.setup();
    montar();
    const boton = await hastaConfirmar(user);
    await user.click(boton);

    const alerta = await screen.findByRole('alert');
    await user.click(
      await within(alerta).findByRole('button', { name: 'Volver a comparar' }),
    );

    expect(ejecutarFusion).toHaveBeenCalledTimes(1);
    // Vuelve al paso de comparar, con datos frescos.
    expect(await screen.findByText('Contacto principal')).toBeInTheDocument();
    await waitFor(() =>
      expect(compararContactos.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it('una respuesta que llega tarde NO puede pintar éxito después de descartarla', async () => {
    // La peticion queda colgada; la persona pulsa «Volver a comparar» y solo
    // entonces responde con exito. Ese exito ya no es de nadie: pertenece a
    // una operacion que se descarto, y pintarlo fue lo que hizo aparecer una
    // pantalla de fusion completada sin que nadie la pidiera.
    let resolver: (v: unknown) => void = () => {};
    ejecutarFusion.mockImplementation(
      () => new Promise((res) => { resolver = res; }),
    );

    const user = userEvent.setup();
    montar();
    const boton = await hastaConfirmar(user);
    await user.click(boton);
    await waitFor(() => expect(ejecutarFusion).toHaveBeenCalled());

    // Se abandona la operacion volviendo a comparar.
    await user.click(screen.getByRole('button', { name: 'Volver' }));

    resolver(EXITO);
    await new Promise((r) => setTimeout(r, 60));

    expect(
      screen.queryByText(/se conservaron \d+ registros/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });

  it('un 409 no se convierte en éxito porque otra promesa llegue después', async () => {
    let resolverExito: (v: unknown) => void = () => {};
    ejecutarFusion
      .mockImplementationOnce(() => new Promise((res) => { resolverExito = res; }))
      .mockImplementationOnce(() => Promise.reject(CONFLICTO));

    const user = userEvent.setup();
    montar();
    const boton = await hastaConfirmar(user);

    // Dos eventos en el mismo fotograma: con el candado solo sale uno.
    boton.click();
    boton.click();
    await waitFor(() => expect(ejecutarFusion).toHaveBeenCalledTimes(1));

    resolverExito(EXITO);
    await waitFor(() =>
      expect(
        screen.getByText(/se conservaron \d+ registros/i),
      ).toBeInTheDocument(),
    );
    // Y no queda ninguna alerta de conflicto contradiciendo al exito.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
