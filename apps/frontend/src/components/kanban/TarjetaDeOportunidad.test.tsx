import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";
import { TarjetaDeOportunidad } from "./TarjetaDeOportunidad";
import type { Lead } from "@/types";

const lead: Lead = {
  id: "lead-1",
  title: "Sala Toscana para terraza",
  value: 12_400_000,
  status: "OPEN",
  lostReason: null,
  expectedCloseDate: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  contactId: "contact-1",
  contact: { id: "contact-1", name: "Laura Martínez", phone: "+573001110001" },
  pipelineId: "pipeline-1",
  stageId: "stage-1",
  assignedTo: "u1",
  agent: { id: "u1", name: "Ana Administradora" },
};

const etapas = [
  { id: "stage-1", name: "Nuevo" },
  { id: "stage-2", name: "Contactado" },
];

// Es un `Draggable`: sin `DragDropContext` y `Droppable` encima no llega ni a
// montarse, igual que dentro de una etapa del tablero.
function enTablero(ui: React.ReactElement) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="stage-1" direction="horizontal">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            {ui}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
}

function pintar(props: Partial<React.ComponentProps<typeof TarjetaDeOportunidad>> = {}) {
  const manejadores = {
    onSeleccionar: vi.fn(),
    onAbrirOportunidad: vi.fn(),
    onAbrirConversacion: vi.fn(),
    onMoverDeEtapa: vi.fn(),
  };
  enTablero(
    <TarjetaDeOportunidad
      lead={lead}
      indice={0}
      etapas={etapas}
      seleccionada={false}
      {...manejadores}
      {...props}
    />,
  );
  return manejadores;
}

describe("TarjetaDeOportunidad", () => {
  it("enseña oportunidad, contacto, valor y responsable", () => {
    pintar();
    expect(screen.getByText("Sala Toscana para terraza")).toBeInTheDocument();
    expect(screen.getByText("Laura Martínez")).toBeInTheDocument();
    expect(screen.getByText(/12\.400\.000/)).toBeInTheDocument();
    expect(screen.getByText("Ana Administradora")).toBeInTheDocument();
  });

  it("sin responsable lo ESCRIBE en vez de dejar un hueco", () => {
    pintar({ lead: { ...lead, agent: null, assignedTo: null } });
    expect(screen.getByText("Sin asignar")).toBeInTheDocument();
  });

  it("un valor nulo no imprime «NaN»", () => {
    pintar({ lead: { ...lead, value: null } });
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("el título abre la ficha lateral; no navega a otra pantalla", () => {
    const m = pintar();
    fireEvent.click(screen.getByRole("button", { name: "Sala Toscana para terraza" }));
    expect(m.onSeleccionar).toHaveBeenCalledWith(lead);
    expect(m.onAbrirOportunidad).not.toHaveBeenCalled();
  });

  it("«Abrir chat» y «Oportunidad» son acciones distintas", () => {
    const m = pintar();
    fireEvent.click(screen.getByRole("button", { name: /Abrir chat/ }));
    expect(m.onAbrirConversacion).toHaveBeenCalledWith(lead);
    expect(m.onSeleccionar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Oportunidad/ }));
    expect(m.onAbrirOportunidad).toHaveBeenCalledWith(lead);
  });

  it("cambia de etapa sin arrastrar, y sin abrir nada de paso", () => {
    const m = pintar();
    fireEvent.change(
      screen.getByLabelText("Mover Sala Toscana para terraza a otra etapa"),
      { target: { value: "stage-2" } },
    );
    expect(m.onMoverDeEtapa).toHaveBeenCalledWith("lead-1", "stage-2");
    expect(m.onSeleccionar).not.toHaveBeenCalled();
  });

  it("lista todas las etapas del embudo como destino", () => {
    pintar();
    expect(screen.getByRole("option", { name: "Nuevo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Contactado" })).toBeInTheDocument();
  });

  it("el asa de arrastre tiene nombre accesible: seis puntos no dicen nada", () => {
    pintar();
    expect(
      screen.getByRole("button", {
        name: "Mover Sala Toscana para terraza arrastrando",
      }),
    ).toBeInTheDocument();
  });

  it("el asa NO es un <button>, o el teclado deja de poder arrastrar", () => {
    // La biblioteca de arrastre ignora sus sensores cuando el evento nace en
    // un elemento interactivo. Con `<button>` el asa se ve, se enfoca y la
    // barra espaciadora no levanta nada: se rompe en silencio. Esta prueba
    // existe para que el próximo que lo «arregle» a `<button>` se entere.
    pintar();
    const asa = screen.getByRole("button", {
      name: "Mover Sala Toscana para terraza arrastrando",
    });
    expect(asa.tagName).toBe("SPAN");
    expect(asa).toHaveAttribute("tabindex", "0");
  });

  it("la selección se VE, y no solo en el estado de React", () => {
    const { container } = enTablero(
      <TarjetaDeOportunidad
        lead={lead}
        indice={0}
        etapas={etapas}
        seleccionada
        onSeleccionar={vi.fn()}
        onAbrirOportunidad={vi.fn()}
        onAbrirConversacion={vi.fn()}
        onMoverDeEtapa={vi.fn()}
      />,
    );
    const tarjeta = container.querySelector("article")!;
    expect(tarjeta.className).toContain("ring-2");
    expect(tarjeta.className).toContain("border-brand-primary");
  });

  it("NO es un botón con botones dentro: la tarjeta es un artículo", () => {
    const { container } = enTablero(
      <TarjetaDeOportunidad
        lead={lead}
        indice={0}
        etapas={etapas}
        seleccionada={false}
        onSeleccionar={vi.fn()}
        onAbrirOportunidad={vi.fn()}
        onAbrirConversacion={vi.fn()}
        onMoverDeEtapa={vi.fn()}
      />,
    );
    const tarjeta = container.querySelector("article")!;
    expect(tarjeta.getAttribute("role")).toBeNull();
    expect(tarjeta.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});
