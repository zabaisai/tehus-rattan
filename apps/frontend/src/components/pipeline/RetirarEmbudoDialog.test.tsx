import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RetirarEmbudoDialog } from "./RetirarEmbudoDialog";
import type { Pipeline } from "@/types";

const getResumenDeRetiro = vi.fn();
const getPipelines = vi.fn();
const trasladarOportunidades = vi.fn();
const archivarPipeline = vi.fn();
const deletePipeline = vi.fn();

vi.mock("@/lib/pipeline", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/pipeline")>("@/lib/pipeline");
  return {
    ...real,
    getResumenDeRetiro: (id: string) => getResumenDeRetiro(id),
    getPipelines: () => getPipelines(),
    trasladarOportunidades: (id: string, d: unknown) =>
      trasladarOportunidades(id, d),
    archivarPipeline: (id: string) => archivarPipeline(id),
    deletePipeline: (id: string) => deletePipeline(id),
  };
});

const EMBUDO: Pipeline = {
  id: "p1",
  name: "Ventas 2024",
  isDefault: false,
  isArchived: false,
  order: 0,
  stages: [],
};

function resumen(overrides = {}) {
  return {
    pipelineId: "p1",
    nombre: "Ventas 2024",
    archivado: false,
    esPredeterminado: false,
    oportunidades: { abiertas: 0, ganadas: 0, perdidas: 0, total: 0 },
    porEtapa: [],
    enUsoPorLaConfiguracion: false,
    puede: { eliminar: true, archivar: true, requiereTraslado: false },
    motivo: null,
    ...overrides,
  };
}

function renderDialog(onDone = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RetirarEmbudoDialog
        pipeline={EMBUDO}
        onClose={vi.fn()}
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
}

describe("Retirar un embudo", () => {
  beforeEach(() => {
    getPipelines.mockResolvedValue([
      {
        id: "p2",
        name: "Postventa",
        isDefault: false,
        isArchived: false,
        stages: [{ id: "s9", name: "Entrada", order: 0, color: null }],
      },
      // Un embudo archivado NO puede ser destino: mandar oportunidades ahí
      // las esconde igual de bien que perderlas.
      {
        id: "p3",
        name: "Antiguo",
        isDefault: false,
        isArchived: true,
        stages: [{ id: "s10", name: "Entrada", order: 0, color: null }],
      },
    ]);
    trasladarOportunidades.mockResolvedValue({
      trasladadas: 4,
      destino: { pipeline: "Postventa", etapa: "Entrada" },
    });
    archivarPipeline.mockResolvedValue({ archivado: true, oportunidades: 4 });
    deletePipeline.mockResolvedValue({ id: "p1", eliminado: true });
  });

  afterEach(() => vi.clearAllMocks());

  /**
   * LA REGRESIÓN QUE IMPORTA: un embudo con oportunidades dentro no puede
   * ofrecer un botón de eliminar que funcione. Antes el botón llamaba a la API
   * y el servidor devolvía un error genérico; nadie veía que dentro estaba el
   * trabajo de todo un equipo.
   */
  it("con oportunidades dentro, Eliminar está deshabilitado y se dice cuántas hay", async () => {
    getResumenDeRetiro.mockResolvedValue(
      resumen({
        oportunidades: { abiertas: 4, ganadas: 0, perdidas: 0, total: 4 },
        porEtapa: [{ stageId: "s1", nombre: "Contactado", total: 4 }],
        puede: { eliminar: false, archivar: true, requiereTraslado: true },
        motivo: "Tiene 4 oportunidades.",
      }),
    );
    renderDialog();

    const dialogo = await screen.findByRole("dialog");
    // El recuento se pinta con `<strong>` dentro de la frase, así que el texto
    // está partido en varios nodos: se comprueba sobre el contenido completo.
    await waitFor(() =>
      expect(dialogo.textContent).toMatch(/4 oportunidades/i),
    );
    expect(dialogo.textContent).toMatch(/no se van a eliminar/i);

    expect(
      screen.getByRole("button", { name: "Eliminar" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(deletePipeline).not.toHaveBeenCalled();
  });

  it("un embudo vacío sí se puede eliminar", async () => {
    getResumenDeRetiro.mockResolvedValue(resumen());
    const onDone = vi.fn();
    renderDialog(onDone);

    const eliminar = await screen.findByRole("button", { name: "Eliminar" });
    expect(eliminar.hasAttribute("disabled")).toBe(false);

    await userEvent.click(eliminar);
    await waitFor(() => expect(deletePipeline).toHaveBeenCalledWith("p1"));
    expect(onDone).toHaveBeenCalled();
  });

  it("traslada las oportunidades al embudo y la etapa elegidos, por id", async () => {
    getResumenDeRetiro.mockResolvedValue(
      resumen({
        oportunidades: { abiertas: 4, ganadas: 0, perdidas: 0, total: 4 },
        porEtapa: [{ stageId: "s1", nombre: "Contactado", total: 4 }],
        puede: { eliminar: false, archivar: true, requiereTraslado: true },
      }),
    );
    renderDialog();

    await userEvent.selectOptions(
      await screen.findByLabelText("Embudo de destino"),
      "p2",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Etapa de destino"),
      "s9",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /trasladar 4 oportunidades/i }),
    );

    await waitFor(() =>
      expect(trasladarOportunidades).toHaveBeenCalledWith("p1", {
        pipelineDestinoId: "p2",
        etapaDestinoId: "s9",
      }),
    );
  });

  it("un embudo archivado no aparece como destino posible", async () => {
    getResumenDeRetiro.mockResolvedValue(
      resumen({
        oportunidades: { abiertas: 1, ganadas: 0, perdidas: 0, total: 1 },
        puede: { eliminar: false, archivar: true, requiereTraslado: true },
      }),
    );
    renderDialog();

    const select = await screen.findByLabelText("Embudo de destino");
    const opciones = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent,
    );

    expect(opciones).toContain("Postventa");
    expect(opciones).not.toContain("Antiguo");
  });

  it("archivar conserva las oportunidades y lo dice", async () => {
    getResumenDeRetiro.mockResolvedValue(
      resumen({
        oportunidades: { abiertas: 4, ganadas: 0, perdidas: 0, total: 4 },
        puede: { eliminar: false, archivar: true, requiereTraslado: true },
      }),
    );
    const onDone = vi.fn();
    renderDialog(onDone);

    await userEvent.click(
      await screen.findByRole("button", { name: "Archivar" }),
    );

    await waitFor(() => expect(archivarPipeline).toHaveBeenCalledWith("p1"));
    expect(onDone.mock.calls[0][0]).toMatch(/4 oportunidades intactas/i);
  });

  it("sin otro embudo activo, lo explica en vez de dejar un desplegable vacío", async () => {
    getPipelines.mockResolvedValue([]);
    getResumenDeRetiro.mockResolvedValue(
      resumen({
        oportunidades: { abiertas: 2, ganadas: 0, perdidas: 0, total: 2 },
        puede: { eliminar: false, archivar: true, requiereTraslado: true },
      }),
    );
    renderDialog();

    expect(await screen.findByText(/no hay otro embudo activo/i)).toBeTruthy();
  });
});
