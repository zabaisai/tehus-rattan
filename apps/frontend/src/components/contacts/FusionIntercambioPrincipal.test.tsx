import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContactsPage from '@/app/dashboard/contacts/page';

/**
 * INTERCAMBIAR EL CONTACTO PRINCIPAL — el defecto que encontró la revisión.
 *
 * Se prueba desde la PANTALLA y no desde el componente suelto, porque el fallo
 * no vivía en ninguno de los dos: vivía en el contrato entre ambos. El
 * componente avisaba «el nuevo duplicado es A» y la pantalla, que conservaba
 * «el principal es A», escribía `?fusionar=A&con=A`. La `key` del componente
 * incluye los dos ids, así que remontaba comparando A consigo mismo: dos
 * tarjetas iguales, «Mismo correo» como razón de coincidencia y el resumen de
 * relaciones del principal —que no tiene historial— en vez del del duplicado.
 *
 * Por eso las aserciones miran la URL y los ids que se envían a la comparación:
 * son el sitio exacto donde el defecto se vuelve observable.
 *
 * Ids ficticios; ninguna escritura.
 */

const A = 'contacto-a';
const B = 'contacto-b';

const getContacts = vi.fn();
const getPapelera = vi.fn();
vi.mock('@/lib/contacts', async () => {
  const real = await vi.importActual<typeof import('@/lib/contacts')>('@/lib/contacts');
  return {
    ...real,
    getContacts: () => getContacts(),
    getPapelera: () => getPapelera(),
    archiveContact: vi.fn(),
    restoreContact: vi.fn(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
  };
});

const getCanonico = vi.fn();
const getCandidatos = vi.fn();
const compararContactos = vi.fn();
const ejecutarFusion = vi.fn();
const descartarDuplicado = vi.fn();
vi.mock('@/lib/fusion', async () => {
  const real = await vi.importActual<typeof import('@/lib/fusion')>('@/lib/fusion');
  return {
    ...real,
    getCanonico: (id: string) => getCanonico(id),
    getCandidatos: (id: string) => getCandidatos(id),
    compararContactos: (p: string, d: string) => compararContactos(p, d),
    ejecutarFusion: (x: unknown) => ejecutarFusion(x),
    descartarDuplicado: (a: string, b: string) => descartarDuplicado(a, b),
  };
});

const replace = vi.fn();
const push = vi.fn();
let parametrosDeUrl = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn() }),
  useSearchParams: () => parametrosDeUrl,
}));

vi.mock('@/store/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { role: 'ADMIN' } }),
}));

function contacto(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id === A ? 'QA Valentina Ocampo' : 'QA Valentina O.',
    phone: id === A ? '+573001110101' : '300 111 0101',
    email: id === A ? 'valentina@example.invalid' : 'v.ocampo@example.invalid',
    tags: [],
    altPhones: [],
    altEmails: [],
    archivedAt: id === B ? '2026-08-02T15:00:00.000Z' : null,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:00.000Z',
    mergedIntoId: null,
    ...over,
  };
}

/**
 * Los totales son del DUPLICADO, sea quien sea: el historial que se traslada
 * es el suyo. Si la comparación se pidiera mal, estos números cambiarían, que
 * es justo lo que delató el defecto.
 */
const RELACIONES = {
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
    relaciones: RELACIONES,
    versiones: { principal: `v-${principalId}`, duplicado: `v-${duplicadoId}` },
    decisionesPendientes: 0,
  };
}

let montado: { unmount: () => void } | null = null;

/**
 * Monta la pantalla desmontando la anterior.
 *
 * Volver a montar sin desmontar dejaria DOS arboles en el documento y las
 * consultas encontrarian dos botones iguales. Ademas, desmontar es lo que
 * modela de verdad una recarga: se pierde todo el estado de React y solo
 * queda la URL.
 */
function renderPage() {
  montado?.unmount();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  montado = render(
    <QueryClientProvider client={qc}>
      <ContactsPage />
    </QueryClientProvider>,
  );
  return montado;
}

/**
 * La pantalla escribe la ruta con `history.replaceState`, asi que la URL de
 * verdad esta en `window.location`. Esto la lee y la convierte en lo que
 * devolvera `useSearchParams` en el proximo montaje: exactamente lo que hace
 * el navegador al recargar.
 */
function urlActual() {
  return window.location.search;
}

function aplicarUltimaNavegacion() {
  parametrosDeUrl = new URLSearchParams(window.location.search);
}

beforeEach(() => {
  montado = null;
  vi.clearAllMocks();
  window.history.replaceState(null, '', `/dashboard/contacts?fusionar=${A}&con=${B}`);
  parametrosDeUrl = new URLSearchParams(`fusionar=${A}&con=${B}`);
  getContacts.mockResolvedValue([contacto(A)]);
  getPapelera.mockResolvedValue({ items: [], total: 0 });
  getCandidatos.mockResolvedValue([]);
  getCanonico.mockImplementation((id: string) =>
    Promise.resolve({
      solicitado: id,
      canonicoId: id,
      fueFusionado: false,
      fusionadoEn: null,
    }),
  );
  compararContactos.mockImplementation((p: string, d: string) =>
    Promise.resolve(vista(p, d)),
  );
});

async function pulsarCambiarPrincipal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Cambiar contacto principal' }),
  );
}

describe('Fusión — intercambiar el contacto principal', () => {
  it('arranca comparando A con B, en ese orden', async () => {
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));
  });

  it('al cambiar el principal pide B/A, nunca A/A ni B/B', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));

    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();

    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));
    for (const [p, d] of compararContactos.mock.calls)
      expect(p).not.toBe(d); // ni A/A ni B/B, jamás
  });

  it('la URL queda con los dos ids intercambiados', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));

    await pulsarCambiarPrincipal(user);

    const q = new URLSearchParams(urlActual());
    expect(q.get('fusionar')).toBe(B);
    expect(q.get('con')).toBe(A);
  });

  it('cambiar dos veces devuelve la orientación original A/B', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));

    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));

    await pulsarCambiarPrincipal(user);
    const q = new URLSearchParams(urlActual());
    expect(q.get('fusionar')).toBe(A);
    expect(q.get('con')).toBe(B);
  });

  it('el resumen de relaciones conserva los mismos totales en las dos orientaciones', async () => {
    const user = userEvent.setup();
    renderPage();
    const resumenAntes = await screen.findByRole('region', {
      name: 'Todo esto se conservará',
    });
    const textoAntes = resumenAntes.textContent;

    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();

    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));
    const resumenDespues = await screen.findByRole('region', {
      name: 'Todo esto se conservará',
    });
    expect(resumenDespues.textContent).toBe(textoAntes);
  });

  it('las dos tarjetas siguen siendo dos contactos distintos', async () => {
    const user = userEvent.setup();
    renderPage();
    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();

    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));
    // El principal pasa a ser el que estaba archivado.
    // Se mira DENTRO del diálogo: el listado de contactos de detrás también
    // enseña los mismos nombres y haría ambigua la consulta.
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Contacto principal')).toBeInTheDocument();
    expect(within(dialogo).getByText('Posible duplicado')).toBeInTheDocument();
    // Dos personas distintas, cada una en su tarjeta.
    expect(within(dialogo).getByText('QA Valentina O.')).toBeInTheDocument();
    expect(within(dialogo).getByText('QA Valentina Ocampo')).toBeInTheDocument();
  });

  it('sobrevive a una recarga: los dos ids y cuál es el principal salen de la URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));

    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();

    // Recarga: `renderPage` desmonta, así que se pierde todo el estado de
    // React y lo único que queda es la URL.
    compararContactos.mockClear();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));
  });

  it('atrás del navegador devuelve la orientación anterior sin quedarse pegado', async () => {
    const user = userEvent.setup();
    renderPage();
    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));

    // «Atrás»: el navegador restaura los parámetros anteriores.
    window.history.replaceState(
      null,
      '',
      `/dashboard/contacts?fusionar=${A}&con=${B}`,
    );
    parametrosDeUrl = new URLSearchParams(`fusionar=${A}&con=${B}`);
    compararContactos.mockClear();
    renderPage();

    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));
    // Y no vuelve a escribir la ruta sola: sin bucle de historial.
    expect(new URLSearchParams(urlActual()).get('fusionar')).toBe(A);
    expect(replace).not.toHaveBeenCalled();
  });

  it('una vista previa obsoleta tras el intercambio se explica y ofrece volver a comparar', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));
    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();

    compararContactos.mockRejectedValue({
      response: { status: 409, data: { codigo: 'VISTA_PREVIA_OBSOLETA' } },
    });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Vuelve a compararlos/,
    );
  });

  it('cancelar tras intercambiar no escribe nada', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));

    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(ejecutarFusion).not.toHaveBeenCalled();
    expect(descartarDuplicado).not.toHaveBeenCalled();
  });

  it('el candidato archivado se puede volver principal y se sigue marcando como archivado', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(A, B));
    expect(
      within(await screen.findByRole('dialog')).getByText('Archivado'),
    ).toBeInTheDocument();

    await pulsarCambiarPrincipal(user);
    aplicarUltimaNavegacion();
    renderPage();

    await waitFor(() => expect(compararContactos).toHaveBeenCalledWith(B, A));
    // Ahora el archivado es el principal, y la etiqueta sigue estando.
    expect(
      within(await screen.findByRole('dialog')).getByText('Archivado'),
    ).toBeInTheDocument();
  });
});
