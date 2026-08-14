import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Perfil360Page from "./page";

/**
 * PERFIL 360 (mockup 18).
 *
 * Lo que se fija: que los enlaces llevan al objeto EXACTO —al hilo, no a la
 * bandeja; a la oportunidad, no al embudo—, que cuando la relación no existe se
 * dice en vez de ofrecer un enlace muerto, y que volver regresa por donde se
 * vino. Un enlace a un contacto absorbido por una fusión resuelve su canónico
 * en vez de dar un 404.
 */

let urlActual = "/dashboard/contacts/k1";
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => urlActual.split("?")[0],
  useSearchParams: () => new URLSearchParams(urlActual.split("?")[1] ?? ""),
}));

const getPerfilComercial = vi.fn();
const getCanonico = vi.fn();

vi.mock("@/lib/perfil", async () => {
  const real = await vi.importActual<typeof import("@/lib/perfil")>(
    "@/lib/perfil",
  );
  return { ...real, getPerfilComercial: (id: string) => getPerfilComercial(id) };
});
vi.mock("@/lib/fusion", async () => {
  const real = await vi.importActual<typeof import("@/lib/fusion")>(
    "@/lib/fusion",
  );
  return { ...real, getCanonico: (id: string) => getCanonico(id) };
});

const perfil = (extra: Record<string, unknown> = {}) => ({
  contacto: {
    id: "k1",
    nombre: "Laura Martínez",
    telefono: "+573001110004",
    email: "laura@example.invalid",
    etiquetas: ["Cliente VIP"],
    bloqueado: false,
    archivadoEn: null,
    motivoDeArchivo: null,
    anonimizado: false,
    creadoEn: "2026-05-15T10:00:00.000Z",
  },
  empresa: { id: "e1", nombre: "Muebles del Valle" },
  oportunidad: null,
  conversacion: null,
  tareasPendientes: [],
  cotizaciones: [],
  camposPersonalizados: [],
  pulso: null,
  actividad: [],
  resumen: {
    valorAbierto: 0,
    conversaciones: 0,
    oportunidades: 0,
    tareasPendientes: 0,
    cotizaciones: 0,
    documentos: 0,
  },
  conversaciones: [],
  oportunidades: [],
  documentos: [],
  ultimaInteraccionEn: null,
  ...extra,
});

/** Un contacto con de todo, para las pestañas y las métricas. */
const perfilCompleto = () =>
  perfil({
    oportunidad: {
      id: 'lead-3',
      titulo: 'Comedor para terraza',
      valor: 8400000,
      estado: 'OPEN',
      pipeline: { id: 'emb-1', nombre: 'Ventas' },
      etapa: { id: 's1', nombre: 'Negociación', color: null },
      asesor: { id: 'u1', nombre: 'Ana Administradora' },
    },
    conversacion: {
      id: 'conv-7',
      estado: 'OPEN',
      pausada: false,
      asesor: { id: 'u1', nombre: 'Ana Administradora' },
      ultimoMensaje: {
        cuerpo: '¿Me confirma el precio?',
        entrante: true,
        fecha: '2026-08-14T17:00:00.000Z',
      },
    },
    tareasPendientes: [
      { id: 't1', titulo: 'Enviar cotización', vence: '2026-08-15T12:00:00.000Z', prioridad: 'HIGH' },
    ],
    cotizaciones: [
      { id: 'q1', numero: 'COT-0021', estado: 'SENT', total: 12400000, creadaEn: '2026-08-10T12:00:00.000Z' },
      { id: 'q2', numero: 'COT-0022', estado: 'DRAFT', total: 900000, creadaEn: '2026-08-12T12:00:00.000Z' },
    ],
    documentos: [
      { id: 'q1', numero: 'COT-0021', estado: 'SENT', creadaEn: '2026-08-10T12:00:00.000Z' },
    ],
    conversaciones: [
      { id: 'conv-7', canal: 'whatsapp', estado: 'OPEN', pausada: false, ultimoMensajeEn: '2026-08-14T17:00:00.000Z', asesor: { id: 'u1', nombre: 'Ana Administradora' } },
      { id: 'conv-8', canal: 'whatsapp', estado: 'ARCHIVED', pausada: false, ultimoMensajeEn: '2026-06-01T17:00:00.000Z', asesor: null },
    ],
    oportunidades: [
      { id: 'lead-3', titulo: 'Comedor para terraza', valor: 8400000, estado: 'OPEN', pipeline: { id: 'emb-1', nombre: 'Ventas' }, etapa: { id: 's1', nombre: 'Negociación', color: null }, asesor: { id: 'u1', nombre: 'Ana Administradora' }, actualizadaEn: '2026-08-14T17:00:00.000Z' },
      { id: 'lead-4', titulo: 'Sala anterior', valor: 3000000, estado: 'WON', pipeline: { id: 'emb-1', nombre: 'Ventas' }, etapa: { id: 's5', nombre: 'Ganado', color: null }, asesor: null, actualizadaEn: '2026-05-14T17:00:00.000Z' },
    ],
    actividad: [
      { tipo: 'etapa', descripcion: 'Pasó a «Negociación»', fecha: '2026-08-13T17:00:00.000Z' },
      { tipo: 'cotizacion', descripcion: 'Cotización COT-0021', fecha: '2026-08-10T12:00:00.000Z' },
    ],
    ultimaInteraccionEn: '2026-08-14T17:00:00.000Z',
    resumen: {
      valorAbierto: 8400000,
      conversaciones: 2,
      oportunidades: 2,
      tareasPendientes: 1,
      cotizaciones: 2,
      documentos: 1,
    },
  });

/**
 * `params` es una promesa en Next 16 y el componente la consume con `use()`,
 * que suspende. Sin envolver el montaje en un `act` esperado, React deja el
 * árbol suspendido y el cuerpo vacío para siempre.
 */
async function montar(url = "/dashboard/contacts/k1") {
  urlActual = url;
  const id = url.split("?")[0].split("/").pop() as string;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Perfil360Page params={Promise.resolve({ id })} />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCanonico.mockResolvedValue({
    solicitado: "k1",
    canonicoId: "k1",
    fueFusionado: false,
    fusionadoEn: null,
  });
  getPerfilComercial.mockResolvedValue(perfil());
});

describe("Perfil 360", () => {
  it("enseña la identidad del contacto", async () => {
    await montar();
    expect(
      await screen.findByRole("heading", { name: "Laura Martínez" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("+573001110004").length).toBeGreaterThan(0);
  });

  it("reutiliza el MISMO contrato que la ficha lateral", async () => {
    await montar();
    await screen.findByRole("heading", { name: "Laura Martínez" });
    expect(getPerfilComercial).toHaveBeenCalledWith("k1");
  });
});

describe("Perfil 360 — enlaces al objeto exacto", () => {
  it("«Abrir conversación» lleva al hilo, no a la bandeja", async () => {
    getPerfilComercial.mockResolvedValue(
      perfil({
        conversacion: {
          id: "conv-7",
          estado: "OPEN",
          pausada: false,
          asesor: null,
          ultimoMensaje: null,
        },
      }),
    );
    await montar();

    const enlace = await screen.findByRole("link", {
      name: /abrir conversación/i,
    });
    expect(enlace.getAttribute("href")).toContain("c=conv-7");
  });

  it("sin conversación no ofrece un enlace muerto", async () => {
    await montar();
    await screen.findByRole("heading", { name: "Laura Martínez" });
    expect(
      screen.queryByRole("link", { name: /abrir conversación/i }),
    ).toBeNull();
    expect(screen.getByText(/sin conversación todavía/i)).toBeInTheDocument();
  });

  it("«Ver en pipeline» lleva a la oportunidad exacta", async () => {
    getPerfilComercial.mockResolvedValue(
      perfil({
        oportunidad: {
          id: "lead-3",
          titulo: "Sala Toscana",
          valor: 12400000,
          estado: "OPEN",
          pipeline: { id: "emb-1", nombre: "Ventas" },
          etapa: { id: "s1", nombre: "Negociación", color: null },
          asesor: null,
        },
      }),
    );
    await montar();

    const enlace = await screen.findByRole("link", { name: /ver en pipeline/i });
    expect(enlace.getAttribute("href")).toContain("lead=lead-3");
    expect(enlace.getAttribute("href")).toContain("embudo=emb-1");
  });

  it("sin oportunidad lo dice en vez de inventar una", async () => {
    await montar();
    await screen.findByRole("heading", { name: "Laura Martínez" });
    // Se dice dos veces a proposito: en la accion del encabezado, que queda
    // inerte, y en la tarjeta de la columna derecha.
    expect(screen.getAllByText(/sin oportunidad abierta/i).length).toBeGreaterThan(0);
  });
});


describe('Perfil 360 — estructura del mockup 18', () => {
  it('las métricas salen de los conteos del servidor, no de las listas recortadas', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    await screen.findByRole('heading', { name: 'Laura Martínez' });
    // Valor abierto, cotizaciones, tareas y conversaciones.
    expect(screen.getByLabelText(/ver oportunidades/i)).toHaveTextContent('8.400.000');
    expect(screen.getByLabelText(/ver cotizaciones/i)).toHaveTextContent('2');
    expect(screen.getByLabelText(/ver tareas/i)).toHaveTextContent('1');
    expect(screen.getByLabelText(/ver conversaciones/i)).toHaveTextContent('2');
  });

  it('tiene las seis pestañas con sus conteos reales', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    const tablist = await screen.findByRole('tablist', {
      name: /objetos relacionados/i,
    });
    const nombres = within(tablist)
      .getAllByRole('tab')
      .map((t) => (t.textContent || '').trim());
    expect(nombres).toEqual([
      'Actividad',
      'Conversaciones2',
      'Oportunidades2',
      'Tareas1',
      'Cotizaciones2',
      'Documentos1',
    ]);
  });

  it('la barra de pestañas no se envuelve: se desplaza si no cabe', async () => {
    // Envolviendo, «Documentos 0» caia a una segunda fila y la barra dejaba de
    // leerse como una barra.
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    const tablist = await screen.findByRole('tablist', {
      name: /objetos relacionados/i,
    });
    expect(tablist.className).toContain('flex-nowrap');
    expect(tablist.className).toContain('overflow-x-auto');
    expect(tablist.className).not.toContain('flex-wrap');
  });

  it('ninguna pestaña se parte en dos lineas', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    const tablist = await screen.findByRole('tablist', {
      name: /objetos relacionados/i,
    });
    for (const t of within(tablist).getAllByRole('tab')) {
      expect(t.className).toContain('whitespace-nowrap');
      expect(t.className).toContain('shrink-0');
    }
  });

  it('los valores largos llevan su valor completo accesible', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();
    await screen.findByRole('heading', { name: 'Laura Martínez' });

    const conTitulo = [...document.querySelectorAll('[title]')].map((e) =>
      e.getAttribute('title'),
    );
    expect(conTitulo).toContain('laura@example.invalid');
    expect(conTitulo).toContain('Muebles del Valle');
  });

  it('la pestaña de conversaciones lista cada hilo y lo abre exacto', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    const user = userEvent.setup();
    await montar();

    await user.click(await screen.findByRole('tab', { name: /conversaciones/i }));

    const enlaces = screen.getAllByRole('link', { name: 'Abrir' });
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0].getAttribute('href')).toContain('c=conv-7');
    expect(enlaces[1].getAttribute('href')).toContain('c=conv-8');
  });

  it('la pestaña de oportunidades lista TODAS, no solo la abierta', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    const user = userEvent.setup();
    await montar();

    await user.click(await screen.findByRole('tab', { name: /oportunidades/i }));

    // El titulo tambien esta en la tarjeta de la columna derecha; aqui se mira
    // solo dentro de la pestaña.
    const panel = screen.getByRole('tab', { name: /oportunidades/i })
      .closest('div')?.parentElement as HTMLElement;
    expect(within(panel).getAllByText('Comedor para terraza').length).toBe(1);
    expect(within(panel).getByText('Sala anterior')).toBeInTheDocument();
    const ver = screen.getAllByRole('link', { name: 'Ver' });
    expect(ver[0].getAttribute('href')).toContain('lead=lead-3');
  });

  it('los documentos son los PDF emitidos, y se dice', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    const user = userEvent.setup();
    await montar();

    await user.click(await screen.findByRole('tab', { name: /documentos/i }));

    expect(screen.getByText('COT-0021')).toBeInTheDocument();
    expect(screen.getByText(/PDF de una cotización emitida/i)).toBeInTheDocument();
  });

  it('pulsar una métrica lleva a su pestaña', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    const user = userEvent.setup();
    await montar();

    await user.click(await screen.findByLabelText(/ver cotizaciones/i));

    expect(
      screen.getByRole('tab', { name: /cotizaciones/i }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('la columna derecha enseña la oportunidad activa con etapa, valor y responsable', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    await screen.findByRole('heading', { name: 'Laura Martínez' });
    const oportunidad = screen
      .getAllByRole('heading', { name: /oportunidad activa/i })[0]
      .closest('section') as HTMLElement;

    expect(within(oportunidad).getByText('Negociación')).toBeInTheDocument();
    expect(within(oportunidad).getByText(/8\.400\.000/)).toBeInTheDocument();
    expect(
      within(oportunidad).getByText('Ana Administradora'),
    ).toBeInTheDocument();
    expect(
      within(oportunidad).getByRole('link', { name: /abrir en pipeline/i }),
    ).toHaveAttribute('href', expect.stringContaining('lead=lead-3'));
  });

  it('el contexto de conversación lleva al hilo exacto', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    const enlace = await screen.findByRole('link', { name: /ir al chat/i });
    expect(enlace.getAttribute('href')).toContain('c=conv-7');
  });

  it('el encabezado enseña responsable y última interacción reales', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    const cabecera = (
      await screen.findByRole('heading', { name: 'Laura Martínez' })
    ).closest('header') as HTMLElement;
    expect(cabecera).toHaveTextContent('Ana Administradora');
    expect(cabecera).toHaveTextContent(/Última interacción/);
  });

  it('sin nada, las seis pestañas siguen ahí en cero con estados honestos', async () => {
    await montar();

    const tablist = await screen.findByRole('tablist', {
      name: /objetos relacionados/i,
    });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByText(/sin movimientos todavía/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ver conversaciones/i)).toHaveTextContent('0');
  });

  it('no inventa las cifras que el producto no tiene', async () => {
    getPerfilComercial.mockResolvedValue(perfilCompleto());
    await montar();

    await screen.findByRole('heading', { name: 'Laura Martínez' });
    expect(screen.queryByText(/calidad de datos/i)).toBeNull();
    expect(screen.queryByText(/relación activa/i)).toBeNull();
    expect(screen.queryByText(/última compra/i)).toBeNull();
  });
});

describe("Perfil 360 — volver conserva el contexto", () => {
  it("regresa al hilo del que se vino", async () => {
    await montar(
      "/dashboard/contacts/k1?volverA=" +
        encodeURIComponent("/dashboard/conversations?c=conv-1&vista=mias"),
    );

    const volver = await screen.findByRole("link", { name: /volver/i });
    expect(volver).toHaveAttribute(
      "href",
      "/dashboard/conversations?c=conv-1&vista=mias",
    );
  });

  it("sin ruta de regreso cae en la lista de contactos", async () => {
    await montar();
    const volver = await screen.findByRole("link", { name: /volver/i });
    expect(volver).toHaveAttribute("href", "/dashboard/contacts");
  });
});

describe("Perfil 360 — estados honestos", () => {
  it("un contacto absorbido por fusión resuelve a su canónico y lo avisa", async () => {
    getCanonico.mockResolvedValue({
      solicitado: "viejo",
      canonicoId: "k1",
      fueFusionado: true,
      fusionadoEn: "2026-08-14T16:12:30.000Z",
    });
    await montar("/dashboard/contacts/viejo");

    await screen.findByRole("heading", { name: "Laura Martínez" });
    expect(getPerfilComercial).toHaveBeenCalledWith("k1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      /se fusionó dentro de otra/i,
    );
  });

  it("un contacto de otra empresa da un estado seguro", async () => {
    getPerfilComercial.mockRejectedValue({ response: { status: 404 } });
    await montar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no está disponible/i,
    );
  });

  it("sin permiso lo cuenta como permiso, no como avería", async () => {
    getPerfilComercial.mockRejectedValue({ response: { status: 403 } });
    await montar();
    expect(
      await screen.findByText(/no puedes ver este contacto/i),
    ).toBeInTheDocument();
  });

  it("las secciones vacías se dicen, no se ocultan", async () => {
    const user = userEvent.setup();
    await montar();
    await screen.findByRole("heading", { name: "Laura Martínez" });

    // La actividad es la pestaña de entrada.
    expect(screen.getByText(/sin movimientos todavía/i)).toBeInTheDocument();
    // Y la columna derecha lo dice sin tener que buscar.
    expect(screen.getAllByText(/nada pendiente/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: /cotizaciones/i }));
    expect(screen.getByText(/todavía no se ha cotizado/i)).toBeInTheDocument();
  });
});
