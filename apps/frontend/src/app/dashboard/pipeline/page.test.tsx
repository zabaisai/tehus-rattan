import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PipelinePage from "./page";
import { useAuthStore } from "@/store/auth.store";

const getPipelines = vi.fn();
const getKanban = vi.fn();

vi.mock("@/lib/pipeline", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/pipeline")>("@/lib/pipeline");
  return {
    ...real,
    getPipelines: () => getPipelines(),
    getKanban: (id: string) => getKanban(id),
  };
});

const getOverview = vi.fn();
vi.mock("@/lib/analytics", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/analytics")>("@/lib/analytics");
  return { ...real, getOverview: () => getOverview() };
});

vi.mock("@/lib/use-realtime", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/use-realtime")>(
      "@/lib/use-realtime",
    );
  return { ...real, useRealtime: () => ({ enVivo: false }) };
});

vi.mock("@/components/kanban/TableroVertical", () => ({
  TableroVertical: (props: { onSeleccionar: (l: unknown) => void }) => (
    <div data-testid="tablero">
      <button
        onClick={() =>
          props.onSeleccionar({ id: "l1", contact: { id: "c1" } })
        }
      >
        seleccionar-tarjeta
      </button>
    </div>
  ),
}));

vi.mock("@/components/perfil/PerfilComercial", () => ({
  PerfilComercial: ({
    contactId,
    oportunidadPreferidaId,
  }: {
    contactId: string;
    oportunidadPreferidaId?: string | null;
  }) => (
    <aside data-testid="perfil">
      {contactId}/{oportunidadPreferidaId ?? "sin-preferida"}
    </aside>
  ),
}));

// La pantalla escribe la URL con la History API, no con el router: es lo único
// que se aplica en el build de producción cuando la ruta no cambia. Estos
// espías sustituyen a `pushState`/`replaceState` para poder comprobarlo.
const pushState = vi.fn();
const replaceState = vi.fn();
let parametros = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard/pipeline",
  useSearchParams: () => parametros,
}));

function embudo(over = {}) {
  return {
    id: "p1",
    name: "Embudo comercial",
    isDefault: true,
    stages: [
      { id: "s1", name: "Nuevo", order: 0, color: "#2A5FD6", isInitial: true },
      { id: "s2", name: "Cotizado", order: 1, color: "#C24A00" },
    ],
    ...over,
  };
}

function kanban() {
  return {
    pipeline: { id: "p1", name: "Embudo comercial" },
    stages: [
      {
        id: "s1",
        name: "Nuevo",
        order: 0,
        color: "#2A5FD6",
        leadCount: 2,
        totalValue: 20_400_000,
        leads: [
          {
            id: "l1",
            title: "Sala Toscana",
            value: 12_400_000,
            status: "OPEN",
            lostReason: null,
            expectedCloseDate: null,
            createdAt: "2026-08-01T10:00:00.000Z",
            updatedAt: "2026-08-01T10:00:00.000Z",
            contactId: "c1",
            contact: { id: "c1", name: "Laura", phone: "+57300" },
            pipelineId: "p1",
            stageId: "s1",
            assignedTo: "u1",
            agent: { id: "u1", name: "Ana" },
          },
          {
            id: "l2",
            title: "Comedor Roble",
            value: 8_000_000,
            status: "OPEN",
            lostReason: null,
            expectedCloseDate: null,
            createdAt: "2026-08-01T10:00:00.000Z",
            updatedAt: "2026-08-01T10:00:00.000Z",
            contactId: "c2",
            contact: { id: "c2", name: "Juan", phone: "+57301" },
            pipelineId: "p1",
            stageId: "s1",
            assignedTo: null,
            agent: null,
          },
        ],
      },
    ],
  };
}

function pintar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PipelinePage />
    </QueryClientProvider>,
  );
}

function comoRol(role: "ADMIN" | "AGENT") {
  useAuthStore.setState({
    user: {
      id: "u1",
      name: "Quien sea",
      email: "q@e.co",
      role,
      companyId: "e1",
    },
  } as never);
}

describe("PipelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parametros = new URLSearchParams();
    getPipelines.mockResolvedValue([embudo()]);
    getKanban.mockResolvedValue(kanban());
    getOverview.mockResolvedValue({
      conversionRate: 18.4,
      wonCount: 9,
      lostCount: 40,
    });
    comoRol("ADMIN");
    vi.spyOn(window.history, "pushState").mockImplementation(pushState);
    vi.spyOn(window.history, "replaceState").mockImplementation(replaceState);
  });

  it("sin embudos lo dice, y no como un error", async () => {
    getPipelines.mockResolvedValue([]);
    pintar();
    expect(
      await screen.findByText("No hay embudos creados todavía."),
    ).toBeInTheDocument();
  });

  it("un fallo de carga NO se ve como «no hay embudos»", async () => {
    getPipelines.mockRejectedValue(new Error("boom"));
    pintar();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByText("No hay embudos creados todavía."),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("tablero")).not.toBeInTheDocument();
  });

  it("un 403 no se ve como una avería: dice que falta permiso", async () => {
    getPipelines.mockRejectedValue({ response: { status: 403 } });
    pintar();
    expect(
      await screen.findByText("No tienes permiso para ver el embudo"),
    ).toBeInTheDocument();
  });

  it("las cifras del embudo salen del MISMO tablero que se está viendo", async () => {
    pintar();
    // 2 oportunidades, $20.400.000 y una sin responsable: exactamente lo que
    // suman las tarjetas del kanban, no una consulta aparte.
    expect(await screen.findByText(/20\.400\.000/)).toBeInTheDocument();

    const cifra = (etiqueta: string) =>
      screen.getByText(etiqueta).closest("div")!.textContent;
    expect(cifra("oportunidades abiertas")).toContain("2");
    expect(cifra("sin responsable")).toContain("1");
  });

  it("la conversión declara que es de la empresa, no de este embudo", async () => {
    pintar();
    expect(await screen.findByText("18,4 %")).toBeInTheDocument();
    expect(
      screen.getByText("ganadas frente a cerradas, todos los embudos"),
    ).toBeInTheDocument();
  });

  it("con un solo embudo no dibuja un desplegable de una opción, pero sí su nombre", async () => {
    pintar();
    await screen.findByTestId("tablero");
    expect(screen.queryByLabelText("Pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("Embudo comercial")).toBeInTheDocument();
  });

  it("con varios embudos aparece el selector y cambiarlo se ESCRIBE en la URL", async () => {
    getPipelines.mockResolvedValue([
      embudo(),
      embudo({ id: "p2", name: "Posventa", isDefault: false }),
    ]);
    pintar();

    fireEvent.change(await screen.findByLabelText("Pipeline"), {
      target: { value: "p2" },
    });

    await waitFor(() => expect(pushState).toHaveBeenCalled());
    expect(pushState.mock.calls.at(-1)![2]).toContain("embudo=p2");
  });

  it("seleccionar una tarjeta abre la ficha lateral y lo deja en la URL", async () => {
    pintar();
    fireEvent.click(await screen.findByText("seleccionar-tarjeta"));

    await waitFor(() => expect(pushState).toHaveBeenCalled());
    const url = pushState.mock.calls.at(-1)![2] as string;
    expect(url).toContain("sel=l1");
    expect(url).toContain("perfil=c1");
  });

  it("la ficha enseña la oportunidad de la tarjeta pulsada, no otra del contacto", async () => {
    parametros = new URLSearchParams("perfil=c1&sel=l1");
    pintar();
    expect(await screen.findByTestId("perfil")).toHaveTextContent("c1/l1");
  });

  it("un rol sin administración no ve «Configurar etapas»", async () => {
    comoRol("AGENT");
    pintar();
    await screen.findByTestId("tablero");
    expect(
      screen.queryByRole("button", { name: /Configurar etapas/ }),
    ).not.toBeInTheDocument();
    // Crear una oportunidad sí, que es trabajo de asesor.
    expect(
      screen.getByRole("button", { name: /Nueva oportunidad/ }),
    ).toBeInTheDocument();
  });

  it("un administrador sí lo ve", async () => {
    pintar();
    await screen.findByTestId("tablero");
    expect(
      await screen.findByRole("button", { name: /Configurar etapas/ }),
    ).toBeInTheDocument();
  });

  it("teclear en el buscador no llena el historial: usa replace", async () => {
    pintar();
    await screen.findByTestId("tablero");

    fireEvent.change(screen.getByLabelText("Buscar oportunidades"), {
      target: { value: "toscana" },
    });

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls.at(-1)![2]).toContain("q=toscana");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("el filtro por responsable lista a quien de verdad tiene tarjetas", async () => {
    pintar();
    expect(await screen.findByRole("option", { name: "Ana" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Sin responsable" }),
    ).toBeInTheDocument();
  });

  it("con filtro, las cifras cuentan lo FILTRADO y lo dicen", async () => {
    parametros = new URLSearchParams("q=comedor");
    pintar();
    // Solo «Comedor Roble» pasa el filtro: 1 de 2, y $8.000.000 en curso.
    expect(await screen.findByText(/8\.000\.000/)).toBeInTheDocument();

    const cifra = (etiqueta: string) =>
      screen.getByText(etiqueta).closest("div")!.textContent;
    // Y en singular: «1 oportunidades abiertas» es de las cosas que se leen
    // como que el producto no está terminado.
    expect(cifra("oportunidad abierta")).toContain("1");
    expect(screen.queryByText("oportunidades abiertas")).not.toBeInTheDocument();
    expect(
      screen.getByText("Mostrando 1 de 2 oportunidades"),
    ).toBeInTheDocument();
  });

  it("sin nada cerrado, la conversión es «—» y no un 0 % que afirma un fracaso", async () => {
    getOverview.mockResolvedValue({
      conversionRate: 0,
      wonCount: 0,
      lostCount: 0,
    });
    pintar();
    expect(
      await screen.findByText("todavía no hay oportunidades ganadas ni perdidas"),
    ).toBeInTheDocument();
    expect(screen.queryByText("0 %")).not.toBeInTheDocument();
  });

  it("«Plegar todas» deja las etapas del embudo en la URL", async () => {
    pintar();
    fireEvent.click(await screen.findByRole("button", { name: "Plegar todas" }));

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls.at(-1)![2]).toContain("plegadas=s1%2Cs2");
  });
});
