import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PerfilComercial } from "./PerfilComercial";
import type { PerfilComercial as Contrato } from "@/lib/perfil";

const getPerfilComercial = vi.fn();
const archiveContact = vi.fn();
const restoreContact = vi.fn();
const push = vi.fn();

vi.mock("@/lib/perfil", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/perfil")>("@/lib/perfil");
  return {
    ...real,
    getPerfilComercial: (id: string) => getPerfilComercial(id),
  };
});

vi.mock("@/lib/contacts", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return {
    ...real,
    archiveContact: (id: string) => archiveContact(id),
    restoreContact: (id: string) => restoreContact(id),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function perfil(overrides: Partial<Contrato> = {}): Contrato {
  return {
    contacto: {
      id: "ct1",
      nombre: "Ana Restrepo",
      telefono: "+573001112233",
      email: "ana@example.com",
      etiquetas: ["vip"],
      bloqueado: false,
      archivadoEn: null,
      motivoDeArchivo: null,
      anonimizado: false,
      creadoEn: "2026-01-01T00:00:00.000Z",
    },
    empresa: { id: "e1", nombre: "Tehus Rattan" },
    oportunidad: {
      id: "l1",
      titulo: "Sala de ratán",
      valor: 4500000,
      estado: "OPEN",
      pipeline: { id: "p1", nombre: "Ventas" },
      etapa: { id: "s1", nombre: "Cotizando", color: null },
      asesor: { id: "u1", nombre: "Camila Ruiz" },
    },
    conversacion: {
      id: "cv1",
      estado: "OPEN",
      pausada: false,
      asesor: null,
      ultimoMensaje: {
        cuerpo: "¿Me confirma el precio?",
        entrante: true,
        fecha: "2026-08-01T10:00:00.000Z",
      },
    },
    tareasPendientes: [
      { id: "t1", titulo: "Llamar mañana", vence: null, prioridad: "HIGH" },
    ],
    cotizaciones: [
      {
        id: "q1",
        numero: "COT-0007",
        estado: "SENT",
        total: 4500000,
        creadaEn: "2026-08-01T10:00:00.000Z",
      },
    ],
    camposPersonalizados: [
      { key: "ciudad", label: "Ciudad", valor: "Medellín" },
    ],
    pulso: null,
    actividad: [
      {
        tipo: "etapa",
        descripcion: "Pasó a «Cotizando»",
        fecha: "2026-08-01T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function pintar(props: Partial<Parameters<typeof PerfilComercial>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PerfilComercial
        contactId="ct1"
        origen="pipeline"
        onCerrar={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("Perfil comercial", () => {
  beforeEach(() => {
    getPerfilComercial.mockResolvedValue(perfil());
    archiveContact.mockResolvedValue({ archivado: true, yaEstaba: false });
    restoreContact.mockResolvedValue({ restaurado: true, yaEstaba: false });
    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard/pipeline", search: "?embudo=p1" },
      writable: true,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("enseña todo lo que promete, de una sola llamada", async () => {
    pintar();

    expect(await screen.findByText("Ana Restrepo")).toBeTruthy();
    expect(screen.getByText("+573001112233")).toBeTruthy();
    expect(screen.getByText("Tehus Rattan")).toBeTruthy();
    expect(screen.getByText("vip")).toBeTruthy();
    expect(screen.getByText("Sala de ratán")).toBeTruthy();
    expect(screen.getByText("Cotizando")).toBeTruthy();
    expect(screen.getByText("Camila Ruiz")).toBeTruthy();
    expect(screen.getByText(/Me confirma el precio/)).toBeTruthy();
    expect(screen.getByText("Llamar mañana")).toBeTruthy();
    expect(screen.getByText("COT-0007")).toBeTruthy();
    expect(screen.getByText("Medellín")).toBeTruthy();
    expect(screen.getByText("Pasó a «Cotizando»")).toBeTruthy();

    // UNA sola llamada: el panel no se arma con consultas sueltas.
    expect(getPerfilComercial).toHaveBeenCalledTimes(1);
  });

  /**
   * LA NAVEGACIÓN QUE IMPORTA.
   *
   * Llevar a la bandeja y que el asesor busque a la persona que acaba de mirar
   * es justo donde se pierde el seguimiento. Tiene que ir al chat EXACTO, y
   * arrastrar de dónde vino para que volver no sea empezar de cero.
   */
  it("«Abrir conversación» va al chat exacto y guarda la ruta de regreso", async () => {
    pintar({ origen: "pipeline" });

    await userEvent.click(
      await screen.findByRole("button", { name: /abrir conversación/i }),
    );

    expect(push).toHaveBeenCalledTimes(1);
    const destino = push.mock.calls[0][0] as string;
    expect(destino).toContain("/dashboard/conversations");
    expect(destino).toContain("c=cv1");
    // El regreso conserva el embudo del que se vino.
    expect(decodeURIComponent(destino)).toContain(
      "volverA=/dashboard/pipeline?embudo=p1",
    );
  });

  it("desde la conversación ofrece volver al embudo por donde se vino", async () => {
    pintar({
      origen: "conversacion",
      volverA: "/dashboard/pipeline?embudo=p1&perfil=ct1",
    });

    await userEvent.click(
      await screen.findByRole("button", { name: /volver al embudo/i }),
    );

    expect(push).toHaveBeenCalledWith(
      "/dashboard/pipeline?embudo=p1&perfil=ct1",
    );
  });

  it("desde el pipeline NO ofrece «volver al embudo»: ya está en él", async () => {
    pintar({ origen: "pipeline" });
    await screen.findByText("Ana Restrepo");

    expect(
      screen.queryByRole("button", { name: /volver al embudo/i }),
    ).toBeNull();
  });

  it("«Abrir oportunidad» lleva al embudo y la oportunidad correctos", async () => {
    pintar();

    await userEvent.click(
      await screen.findByRole("button", { name: /abrir oportunidad/i }),
    );

    expect(push).toHaveBeenCalledWith("/dashboard/pipeline?embudo=p1&lead=l1");
  });

  it("archiva desde el panel y refresca el perfil", async () => {
    pintar();

    await userEvent.click(
      await screen.findByRole("button", { name: /^archivar$/i }),
    );

    await waitFor(() => expect(archiveContact).toHaveBeenCalledWith("ct1"));
  });

  it("un contacto archivado ofrece restaurar, no archivar", async () => {
    getPerfilComercial.mockResolvedValue(
      perfil({
        contacto: {
          ...perfil().contacto,
          archivadoEn: "2026-08-01T10:00:00.000Z",
          motivoDeArchivo: "ya no es cliente",
        },
      }),
    );
    pintar();

    expect(await screen.findByText(/ya no es cliente/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /restaurar/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^archivar$/i })).toBeNull();
  });

  it("un contacto anonimizado no ofrece ni archivar ni restaurar", async () => {
    getPerfilComercial.mockResolvedValue(
      perfil({
        contacto: {
          ...perfil().contacto,
          anonimizado: true,
          archivadoEn: "2026-08-01T10:00:00.000Z",
        },
      }),
    );
    pintar();
    await screen.findByText("Ana Restrepo");

    expect(screen.queryByRole("button", { name: /restaurar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^archivar$/i })).toBeNull();
  });

  it("avisa de que el bot está esperando antes de que alguien escriba encima", async () => {
    getPerfilComercial.mockResolvedValue(
      perfil({
        pulso: {
          ejecucionId: "ex1",
          bot: "Captura de datos",
          estado: "WAITING_INPUT",
          esperando: true,
          yaPasoAPersona: false,
        },
      }),
    );
    pintar();

    expect(await screen.findByText("Captura de datos")).toBeTruthy();
    expect(screen.getByText(/el bot está esperando/i)).toBeTruthy();
  });

  it("un contacto sin oportunidad ni conversación no rompe el panel", async () => {
    getPerfilComercial.mockResolvedValue(
      perfil({
        oportunidad: null,
        conversacion: null,
        tareasPendientes: [],
        cotizaciones: [],
        actividad: [],
      }),
    );
    pintar();

    expect(await screen.findByText("Ana Restrepo")).toBeTruthy();
    expect(screen.getByText("Sin oportunidad abierta.")).toBeTruthy();
    expect(screen.getByText("Nada pendiente.")).toBeTruthy();
    // Sin conversación no se ofrece un botón que llevaría a ninguna parte.
    expect(
      screen.queryByRole("button", { name: /abrir conversación/i }),
    ).toBeNull();
  });

  it("si el perfil no carga, lo dice y deja reintentar", async () => {
    getPerfilComercial.mockRejectedValue(new Error("sin conexión"));
    pintar();

    expect(
      await screen.findByText(/no se pudo cargar el perfil/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeTruthy();
  });
});
