import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  COLORES_DE_ETAPA,
  SelectorDeColor,
  nombreDeColor,
} from "./SelectorDeColor";

describe("SelectorDeColor", () => {
  it("cada color se elige por su NOMBRE, no por su código", () => {
    render(
      <SelectorDeColor
        valor={null}
        onChange={vi.fn()}
        grupo="g"
        etiqueta="Color de la etapa"
      />,
    );

    for (const c of COLORES_DE_ETAPA) {
      expect(screen.getByRole("radio", { name: c.nombre })).toBeInTheDocument();
      // El hexadecimal no es la interfaz (§3.1): no está escrito en pantalla.
      expect(screen.queryByText(c.valor)).not.toBeInTheDocument();
    }
  });

  it("son radios de verdad: recorribles con teclado y con estado anunciado", () => {
    render(
      <SelectorDeColor
        valor="#0E8A5F"
        onChange={vi.fn()}
        grupo="g"
        etiqueta="Color de la etapa"
      />,
    );
    expect(screen.getByRole("radio", { name: "Verde" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Azul" })).not.toBeChecked();
  });

  it("devuelve el color elegido", () => {
    const onChange = vi.fn();
    render(
      <SelectorDeColor
        valor={null}
        onChange={onChange}
        grupo="g"
        etiqueta="Color de la etapa"
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Rojo" }));
    expect(onChange).toHaveBeenCalledWith("#C42B2B");
  });

  it("«Sin color» existe: poner color no puede ser irreversible", () => {
    const onChange = vi.fn();
    render(
      <SelectorDeColor
        valor="#C42B2B"
        onChange={onChange}
        grupo="g"
        etiqueta="Color de la etapa"
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Sin color" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("un color guardado en minúsculas sigue siendo el mismo color", () => {
    render(
      <SelectorDeColor
        valor="#0e8a5f"
        onChange={vi.fn()}
        grupo="g"
        etiqueta="Color de la etapa"
      />,
    );
    expect(screen.getByRole("radio", { name: "Verde" })).toBeChecked();
  });
});

describe("nombreDeColor", () => {
  it("traduce los tonos de marca y no inventa nombres para los que no lo son", () => {
    expect(nombreDeColor("#0E8A5F")).toBe("Verde");
    expect(nombreDeColor("#0e8a5f")).toBe("Verde");
    expect(nombreDeColor(null)).toBe("sin color");
    // Un color heredado que no es de la marca se enseña tal cual, sin fingir.
    expect(nombreDeColor("#7c3aed")).toBe("#7C3AED");
  });
});
