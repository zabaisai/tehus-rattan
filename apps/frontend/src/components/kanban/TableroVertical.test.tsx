import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TableroVertical } from "./TableroVertical";
import type { KanbanData, Lead, Pipeline } from "@/types";

const getKanban = vi.fn();
const changeLeadStage = vi.fn();
const updateStage = vi.fn();

vi.mock("@/lib/pipeline", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/pipeline")>("@/lib/pipeline");
  return {
    ...real,
    getKanban: (...a: unknown[]) => getKanban(...a),
    changeLeadStage: (...a: unknown[]) => changeLeadStage(...a),
    updateStage: (...a: unknown[]) => updateStage(...a),
  };
});

const getPerfilComercial = vi.fn();
vi.mock("@/lib/perfil", async () => {
  const real = await vi.importActual<typeof import("@/lib/perfil")>("@/lib/perfil");
  return { ...real, getPerfilComercial: (id: string) => getPerfilComercial(id) };
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    title: "Sala Toscana",
    value: 12_400_000,
    status: "OPEN",
    lostReason: null,
    expectedCloseDate: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    contactId: "c1",
    contact: { id: "c1", name: "Laura Martínez", phone: "+573001110001" },
    pipelineId: "p1",
    stageId: "s1",
    assignedTo: "u1",
    agent: { id: "u1", name: "Ana Administradora" },
    ...over,
  };
}

const embudo: Pipeline = {
  id: "p1",
  name: "Embudo comercial",
  isDefault: true,
  stages: [
    { id: "s1", name: "Nuevo", order: 0, color: "#2A5FD6", probability: 25, isInitial: true },
    { id: "s2", name: "Cotizado", order: 1, color: "#C24A00", probability: 35 },
    { id: "s3", name: "Ganado", order: 2, color: "#0E8A5F", probability: 100 },
  ],
};

function kanban(): KanbanData {
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
        leads: [lead(), lead({ id: "l2", title: "Comedor Roble", value: 8_000_000, agent: null })],
      },
      {
        id: "s2",
        name: "Cotizado",
        order: 1,
        color: "#C24A00",
        leadCount: 0,
        totalValue: 0,
        leads: [],
      },
      {
        id: "s3",
        name: "Ganado",
        order: 2,
        color: "#0E8A5F",
        leadCount: 0,
        totalValue: 0,
        leads: [],
      },
    ],
  };
}

function pintar(props: Partial<React.ComponentProps<typeof TableroVertical>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const manejadores = {
    onPlegar: vi.fn(),
    onSeleccionar: vi.fn(),
    onAbrirOportunidad: vi.fn(),
    onAgregar: vi.fn(),
  };
  const utils = render(
    <QueryClientProvider client={qc}>
      <TableroVertical
        embudo={embudo}
        filtro={{ q: "", asesor: null }}
        seleccion={null}
        plegadas={[]}
        puedeAdministrar={false}
        {...manejadores}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, ...manejadores, qc };
}

describe("TableroVertical", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getKanban.mockResolvedValue(kanban());
    changeLeadStage.mockResolvedValue({});
    updateStage.mockResolvedValue({});
  });

  it("apila TODAS las etapas del embudo, en su orden", async () => {
    pintar();
    const etapas = await screen.findAllByRole("region");
    expect(etapas.map((e) => e.getAttribute("aria-label"))).toEqual([
      "Etapa Nuevo",
      "Etapa Cotizado",
      "Etapa Ganado",
    ]);
  });

  it("cada etapa dice su cantidad, su valor y su probabilidad de cierre", async () => {
    pintar();
    const nuevo = await screen.findByRole("region", { name: "Etapa Nuevo" });
    expect(nuevo).toHaveTextContent("2");
    expect(nuevo).toHaveTextContent("oportunidades");
    expect(nuevo).toHaveTextContent(/20\.400\.000/);
    expect(nuevo).toHaveTextContent("25%");
  });

  it("una etapa vacía DICE QUÉ HACER en vez de quedarse en blanco", async () => {
    pintar();
    const cotizado = await screen.findByRole("region", { name: "Etapa Cotizado" });
    expect(cotizado).toHaveTextContent("Sin oportunidades en esta etapa.");
  });

  it("con filtro, el vacío distingue «no hay» de «el filtro no deja ver»", async () => {
    pintar({ filtro: { q: "zzz", asesor: null } });
    const nuevo = await screen.findByRole("region", { name: "Etapa Nuevo" });
    expect(nuevo).toHaveTextContent(/no coincide|coincide con el filtro/);
  });

  it("el filtro recalcula la cabecera de la etapa: cabecera y tarjetas cuadran", async () => {
    pintar({ filtro: { q: "comedor", asesor: null } });
    const nuevo = await screen.findByRole("region", { name: "Etapa Nuevo" });
    expect(nuevo).toHaveTextContent("oportunidad");
    expect(nuevo).toHaveTextContent(/8\.000\.000/);
    expect(nuevo).not.toHaveTextContent("Sala Toscana");
  });

  it("una etapa plegada esconde sus tarjetas y lo declara con aria-expanded", async () => {
    pintar({ plegadas: ["s1"] });
    await screen.findByRole("region", { name: "Etapa Nuevo" });
    expect(screen.queryByText("Sala Toscana")).not.toBeInTheDocument();
    const cabecera = screen.getByRole("button", {
      name: "Desplegar la etapa Nuevo",
    });
    expect(cabecera).toHaveAttribute("aria-expanded", "false");
  });

  it("mover una tarjeta se PERSISTE y actualiza las cifras de las dos etapas", async () => {
    pintar();
    await screen.findByText("Sala Toscana");

    fireEvent.change(screen.getByLabelText("Mover Sala Toscana a otra etapa"), {
      target: { value: "s2" },
    });

    await waitFor(() =>
      expect(changeLeadStage).toHaveBeenCalledWith("l1", "s2"),
    );

    const nuevo = screen.getByRole("region", { name: "Etapa Nuevo" });
    const cotizado = screen.getByRole("region", { name: "Etapa Cotizado" });
    expect(nuevo).toHaveTextContent(/8\.000\.000/);
    expect(cotizado).toHaveTextContent(/12\.400\.000/);
  });

  it("si el servidor rechaza el movimiento, la tarjeta VUELVE y se dice por qué", async () => {
    changeLeadStage.mockRejectedValue({
      response: { data: { message: "Esa etapa está bloqueada" } },
    });
    pintar();
    await screen.findByText("Sala Toscana");

    fireEvent.change(screen.getByLabelText("Mover Sala Toscana a otra etapa"), {
      target: { value: "s2" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa etapa está bloqueada",
    );
    const nuevo = screen.getByRole("region", { name: "Etapa Nuevo" });
    expect(nuevo).toHaveTextContent("Sala Toscana");
    expect(nuevo).toHaveTextContent(/20\.400\.000/);
  });

  it("«Abrir chat» lleva al hilo EXACTO y con ruta de regreso", async () => {
    getPerfilComercial.mockResolvedValue({ conversacion: { id: "conv-9" } });
    pintar();
    await screen.findByText("Sala Toscana");

    fireEvent.click(screen.getAllByRole("button", { name: /Abrir chat/ })[0]);

    await waitFor(() => expect(push).toHaveBeenCalled());
    const destino = push.mock.calls[0][0] as string;
    expect(destino).toContain("/dashboard/conversations?c=conv-9");
    expect(destino).toContain("volverA=");
  });

  it("sin conversación lo DICE, en vez de llevar a una bandeja genérica", async () => {
    getPerfilComercial.mockResolvedValue({ conversacion: null });
    pintar();
    await screen.findByText("Sala Toscana");

    fireEvent.click(screen.getAllByRole("button", { name: /Abrir chat/ })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /todavía no tiene ninguna conversación/,
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("sin permiso de administración NO se ofrece editar la etapa", async () => {
    pintar({ puedeAdministrar: false });
    await screen.findByRole("region", { name: "Etapa Nuevo" });
    expect(
      screen.queryByRole("button", { name: "Editar la etapa Nuevo" }),
    ).not.toBeInTheDocument();
  });

  it("con permiso, el color se elige VIENDO los colores, no escribiendo hexadecimales", async () => {
    pintar({ puedeAdministrar: true });
    await screen.findByRole("region", { name: "Etapa Nuevo" });

    fireEvent.click(screen.getByRole("button", { name: "Editar la etapa Nuevo" }));

    expect(screen.getByRole("radio", { name: "Verde" })).toBeInTheDocument();
    expect(screen.queryByText("#0E8A5F")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Verde" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar cambios/ }));

    await waitFor(() =>
      expect(updateStage).toHaveBeenCalledWith("p1", "s1", {
        name: "Nuevo",
        color: "#0E8A5F",
      }),
    );
  });

  it("el editor NO ofrece borrar la etapa: es definitivo y no se descubre pulsando", async () => {
    pintar({ puedeAdministrar: true });
    await screen.findByRole("region", { name: "Etapa Nuevo" });
    fireEvent.click(screen.getByRole("button", { name: "Editar la etapa Nuevo" }));
    expect(screen.queryByText(/Archivar etapa|Eliminar/)).not.toBeInTheDocument();
  });

  it("un fallo de carga NO se ve como un embudo vacío", async () => {
    getKanban.mockRejectedValue(new Error("boom"));
    pintar();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
