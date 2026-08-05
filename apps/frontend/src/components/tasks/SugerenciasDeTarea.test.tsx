import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SugerenciasDeTarea } from "./SugerenciasDeTarea";
import type { SugerenciaDeTarea } from "@/lib/sugerencias";

const getSugerencias = vi.fn();
const aprobarSugerencia = vi.fn();
const rechazarSugerencia = vi.fn();

vi.mock("@/lib/sugerencias", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/sugerencias")>(
      "@/lib/sugerencias",
    );
  return {
    ...real,
    getSugerencias: (f: unknown) => getSugerencias(f),
    aprobarSugerencia: (id: string, a: unknown) => aprobarSugerencia(id, a),
    rechazarSugerencia: (id: string, n?: string) => rechazarSugerencia(id, n),
  };
});

function sugerencia(
  overrides: Partial<SugerenciaDeTarea> = {},
): SugerenciaDeTarea {
  return {
    id: "s1",
    status: "PENDING",
    source: "flowbot",
    reason: "El cliente pidió que le llamaran",
    excerpt: "¿Me pueden llamar mañana?",
    title: "Llamar al cliente",
    description: null,
    priority: "HIGH",
    dueAt: null,
    suggestedAssignee: "u1",
    suggestedUser: { id: "u1", name: "Camila Ruiz" },
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdTaskId: null,
    contactId: "ct1",
    conversationId: null,
    leadId: null,
    contact: { id: "ct1", name: "Ana", phone: "+573001112233" },
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function pintar(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SugerenciasDeTarea {...props} />
    </QueryClientProvider>,
  );
}

describe("Tareas propuestas", () => {
  beforeEach(() => {
    getSugerencias.mockResolvedValue([sugerencia()]);
    aprobarSugerencia.mockResolvedValue({
      tarea: { id: "t1" },
      yaEstaba: false,
    });
    rechazarSugerencia.mockResolvedValue({ rechazada: true });
  });

  afterEach(() => vi.clearAllMocks());

  it("enseña la propuesta con su motivo, su origen y el extracto que la justifica", async () => {
    pintar();

    expect(await screen.findByText("Llamar al cliente")).toBeTruthy();
    expect(screen.getByText("Pulso")).toBeTruthy();
    expect(screen.getByText("Alta")).toBeTruthy();
    expect(screen.getByText("El cliente pidió que le llamaran")).toBeTruthy();
    expect(screen.getByText("¿Me pueden llamar mañana?")).toBeTruthy();
    expect(screen.getByText(/para Camila Ruiz/)).toBeTruthy();
  });

  it("aprobar es lo que crea la tarea", async () => {
    pintar();

    await userEvent.click(
      await screen.findByRole("button", { name: /aprobar/i }),
    );

    await waitFor(() =>
      expect(aprobarSugerencia).toHaveBeenCalledWith("s1", {}),
    );
  });

  it("rechazar no crea nada", async () => {
    pintar();

    await userEvent.click(
      await screen.findByRole("button", { name: /rechazar/i }),
    );

    await waitFor(() => expect(rechazarSugerencia).toHaveBeenCalled());
    expect(rechazarSugerencia.mock.calls[0][0]).toBe("s1");
    expect(aprobarSugerencia).not.toHaveBeenCalled();
  });

  /**
   * Lo que el bot sugiere es un BORRADOR, no una orden: quien aprueba puede
   * corregirlo antes de aceptarlo.
   */
  it("se puede corregir el título antes de aprobar", async () => {
    pintar();

    await userEvent.click(
      await screen.findByRole("button", { name: "Editar" }),
    );
    const campo = screen.getByLabelText(/título de la tarea propuesta/i);
    await userEvent.clear(campo);
    await userEvent.type(campo, "Llamar el lunes");
    await userEvent.click(screen.getByRole("button", { name: /aprobar/i }));

    await waitFor(() =>
      expect(aprobarSugerencia).toHaveBeenCalledWith("s1", {
        title: "Llamar el lunes",
      }),
    );
  });

  it("sin propuestas no pinta un bloque vacío: sería ruido permanente", async () => {
    getSugerencias.mockResolvedValue([]);
    const { container } = pintar();

    await waitFor(() => expect(getSugerencias).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("pide solo las PENDIENTES del contacto que se le pasa", async () => {
    pintar({ contactId: "ct9" });

    await waitFor(() => expect(getSugerencias).toHaveBeenCalled());
    expect(getSugerencias.mock.calls[0][0]).toMatchObject({
      estado: "PENDING",
      contactId: "ct9",
    });
  });

  it("si la decisión falla, lo dice en vez de callarse", async () => {
    aprobarSugerencia.mockRejectedValue({
      response: { data: { message: "Otra persona ya la decidió." } },
    });
    pintar();

    await userEvent.click(
      await screen.findByRole("button", { name: /aprobar/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /otra persona ya la decidió/i,
    );
  });
});
