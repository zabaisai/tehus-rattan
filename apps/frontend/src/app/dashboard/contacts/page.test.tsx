import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ContactsPage from "./page";

const getContacts = vi.fn();
const getPapelera = vi.fn();
const archiveContact = vi.fn();
const restoreContact = vi.fn();

vi.mock("@/lib/contacts", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return {
    ...real,
    getContacts: () => getContacts(),
    getPapelera: () => getPapelera(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
    archiveContact: (id: string) => archiveContact(id),
    restoreContact: (id: string) => restoreContact(id),
  };
});

let rol = "ADMIN";
vi.mock("@/store/auth.store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { role: rol } }),
}));

function contacto(overrides = {}) {
  return {
    id: "c1",
    name: "Ana Restrepo",
    phone: "+573001112233",
    email: "ana@example.com",
    tags: [],
    isBlocked: false,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    archivedReason: null,
    anonymizedAt: null,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContactsPage />
    </QueryClientProvider>,
  );
}

describe("Pantalla de contactos", () => {
  beforeEach(() => {
    rol = "ADMIN";
    getContacts.mockResolvedValue([contacto()]);
    getPapelera.mockResolvedValue({ items: [], total: 0 });
    archiveContact.mockResolvedValue({ archivado: true, yaEstaba: false });
    restoreContact.mockResolvedValue({ restaurado: true, yaEstaba: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /**
   * ESTA ES LA REGRESIÓN QUE IMPORTA.
   *
   * El botón decía «Eliminar contacto» y lo que hacía era archivar. El
   * archivado es la conducta correcta —el historial no se destruye—, pero la
   * etiqueta mentía: quien la pulsaba creía haber borrado datos que seguían
   * ahí. Si alguien vuelve a poner «Eliminar» en la acción principal, esto
   * tiene que ponerse rojo.
   */
  it("la acción principal se llama «Archivar», no «Eliminar»", async () => {
    renderPage();

    const archivar = await screen.findAllByRole("button", {
      name: /archivar a ana restrepo/i,
    });
    expect(archivar.length).toBeGreaterThan(0);

    expect(
      screen.queryByRole("button", { name: /^eliminar contacto$/i }),
    ).toBeNull();
  });

  it("al archivar avisa de que el historial se conserva", async () => {
    renderPage();
    const boton = (
      await screen.findAllByRole("button", { name: /archivar a ana/i })
    )[0];

    await userEvent.click(boton);

    const aviso = (window.confirm as unknown as { mock: { calls: string[][] } })
      .mock.calls[0][0];
    expect(aviso).toMatch(/se conservan/i);
    await waitFor(() => expect(archiveContact).toHaveBeenCalledWith("c1"));
  });

  it("la papelera lista los archivados y permite restaurarlos", async () => {
    getPapelera.mockResolvedValue({
      items: [
        contacto({
          id: "c2",
          name: "Carlos Mesa",
          archivedAt: new Date().toISOString(),
          archivedReason: "ya no es cliente",
        }),
      ],
      total: 1,
    });
    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: "Papelera" }));

    expect(await screen.findAllByText("Carlos Mesa")).not.toHaveLength(0);
    expect(screen.getAllByText("ya no es cliente").length).toBeGreaterThan(0);

    await userEvent.click(
      screen.getAllByRole("button", { name: /restaurar a carlos mesa/i })[0],
    );
    await waitFor(() => expect(restoreContact).toHaveBeenCalledWith("c2"));
  });

  it("un AGENT no ve la eliminación definitiva", async () => {
    rol = "AGENT";
    getPapelera.mockResolvedValue({
      items: [contacto({ id: "c2", archivedAt: new Date().toISOString() })],
      total: 1,
    });
    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: "Papelera" }));
    await screen.findAllByRole("button", { name: /restaurar/i });

    expect(
      screen.queryByRole("button", { name: /eliminar definitivamente/i }),
    ).toBeNull();
  });

  it("un contacto anonimizado no se puede restaurar ni volver a eliminar", async () => {
    getPapelera.mockResolvedValue({
      items: [
        contacto({
          id: "c3",
          name: "Contacto anonimizado",
          archivedAt: new Date().toISOString(),
          anonymizedAt: new Date().toISOString(),
        }),
      ],
      total: 1,
    });
    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: "Papelera" }));
    await screen.findAllByText(/datos personales eliminados/i);

    expect(screen.queryByRole("button", { name: /restaurar/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /eliminar definitivamente/i }),
    ).toBeNull();
  });
});
