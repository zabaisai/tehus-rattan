import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
  ...extra,
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
    expect(screen.getByText(/sin oportunidad abierta/i)).toBeInTheDocument();
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
    await montar();
    await screen.findByRole("heading", { name: "Laura Martínez" });
    expect(screen.getByText(/todavía no se ha cotizado/i)).toBeInTheDocument();
    expect(screen.getByText(/nada pendiente/i)).toBeInTheDocument();
    expect(screen.getByText(/sin movimientos todavía/i)).toBeInTheDocument();
  });
});
