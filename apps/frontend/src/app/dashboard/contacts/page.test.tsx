import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ContactsPage from "./page";

const getListadoDeContactos = vi.fn();
const archiveContact = vi.fn();
const restoreContact = vi.fn();

vi.mock("@/lib/contacts", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/contacts")>("@/lib/contacts");
  return {
    ...real,
    getListadoDeContactos: (o: unknown) => getListadoDeContactos(o),
    createContact: vi.fn(),
    updateContact: vi.fn(),
    archiveContact: (id: string) => archiveContact(id),
    restoreContact: (id: string) => restoreContact(id),
  };
});

/**
 * `useSearchParams` LEE DE `window.location`, como en el navegador.
 *
 * La pantalla escribe la pestaña, la búsqueda y la página con
 * `history.pushState`/`replaceState` —la corrección de 3.y—, así que un doble
 * que devuelva un objeto fijo no podría comprobar nada de eso. Leyendo de
 * `window.location` se puede afirmar sobre la URL real y volver a renderizar
 * para ver qué se pide después.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, prefetch: vi.fn() }),
  usePathname: () => "/dashboard/contacts",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const getCanonico = vi.fn();
vi.mock("@/lib/fusion", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/fusion")>("@/lib/fusion");
  return { ...real, getCanonico: (id: string) => getCanonico(id) };
});

let rol = "ADMIN";
vi.mock("@/store/auth.store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { role: rol } }),
}));

function fila(overrides = {}) {
  return {
    id: "c1",
    nombre: "Ana Restrepo",
    telefono: "+573001112233",
    email: "ana@example.invalid",
    etiquetas: [] as string[],
    bloqueado: false,
    anonimizado: false,
    creadoEn: "2026-03-04T10:00:00.000Z",
    archivadoEn: null as string | null,
    motivoDeArchivo: null as string | null,
    asesor: null as { id: string; nombre: string } | null,
    etapa: null as { id: string; nombre: string; color: string | null } | null,
    conversacionId: null as string | null,
    ultimaInteraccionEn: null as string | null,
    tareasPendientes: 0,
    ...overrides,
  };
}

function listado(items: ReturnType<typeof fila>[], overrides = {}) {
  return {
    items,
    total: items.length,
    contadores: { activos: items.length, archivados: 0 },
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

/** La query de la última llamada al listado. */
const ultimaConsulta = () =>
  getListadoDeContactos.mock.calls.at(-1)?.[0] as {
    vista: string;
    search?: string;
    limit: number;
    offset: number;
  };

const query = () => new URLSearchParams(window.location.search);

describe("Pantalla de contactos (mockup 02)", () => {
  beforeEach(() => {
    push.mockClear();
    window.history.replaceState(null, "", "/dashboard/contacts");
    rol = "ADMIN";
    getCanonico.mockResolvedValue({
      solicitado: "c1",
      canonicoId: "c1",
      fueFusionado: false,
      fusionadoEn: null,
    });
    getListadoDeContactos.mockResolvedValue(listado([fila()]));
    archiveContact.mockResolvedValue({ archivado: true, yaEstaba: false });
    restoreContact.mockResolvedValue({ restaurado: true, yaEstaba: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("listado de activos", () => {
    it("pide los ACTIVOS y enseña las columnas del mockup", async () => {
      getListadoDeContactos.mockResolvedValue(
        listado([
          fila({
            asesor: { id: "u1", nombre: "Ana Administradora" },
            etapa: { id: "s1", nombre: "Negociación", color: "#131C4A" },
            ultimaInteraccionEn: new Date().toISOString(),
            tareasPendientes: 2,
            etiquetas: ["Cliente VIP"],
          }),
        ]),
      );
      renderPage();

      expect(await screen.findByText("Ana Restrepo")).toBeInTheDocument();
      expect(ultimaConsulta().vista).toBe("activos");
      expect(screen.getByText("+573001112233")).toBeInTheDocument();
      expect(screen.getByText("Ana Administradora")).toBeInTheDocument();
      expect(screen.getByText("Negociación")).toBeInTheDocument();
      expect(screen.getByText("Cliente VIP")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("el estado se dice con TEXTO, no solo con color", async () => {
      renderPage();
      expect(await screen.findByText("Activa")).toBeInTheDocument();
    });

    it("«Sin asignar» se marca cuando no hay asesor", async () => {
      renderPage();
      expect(await screen.findByText("Sin asignar")).toBeInTheDocument();
    });

    it("el nombre ABRE EL PERFIL 360 y lleva la vuelta al listado", async () => {
      // El hueco que cerraba este incremento: 3.y construyó
      // `/dashboard/contacts/[id]` y Contactos nunca enlazaba a él.
      window.history.replaceState(null, "", "/dashboard/contacts?vista=papelera");
      renderPage();

      const enlace = await screen.findByRole("link", { name: /Ana Restrepo/ });
      expect(enlace).toHaveAttribute(
        "href",
        `/dashboard/contacts/c1?volverA=${encodeURIComponent("/dashboard/contacts?vista=papelera")}`,
      );
    });

    it("«Abrir chat» lleva a la conversación EXACTA", async () => {
      getListadoDeContactos.mockResolvedValue(
        listado([fila({ conversacionId: "conv-9" })]),
      );
      renderPage();

      const enlace = await screen.findByRole("link", { name: /Abrir chat/ });
      expect(enlace.getAttribute("href")).toContain(
        "/dashboard/conversations?c=conv-9",
      );
    });

    it("sin conversación NO se dibuja un botón que no lleva a ningún sitio", async () => {
      renderPage();
      await screen.findByText("Ana Restrepo");
      expect(screen.queryByRole("link", { name: /Abrir chat/ })).toBeNull();
      expect(screen.getByText("Sin conversación")).toBeInTheDocument();
    });
  });

  describe("papelera", () => {
    it("la pestaña viaja a la URL y cambia lo que se pide al servidor", async () => {
      const { rerender } = renderPage();
      await screen.findByText("Ana Restrepo");

      await userEvent.click(screen.getByRole("tab", { name: /Papelera/ }));

      expect(query().get("vista")).toBe("papelera");

      getListadoDeContactos.mockResolvedValue(
        listado(
          [
            fila({
              id: "c2",
              nombre: "Carlos Mesa",
              archivadoEn: new Date().toISOString(),
              motivoDeArchivo: "ya no es cliente",
            }),
          ],
          { contadores: { activos: 0, archivados: 1 } },
        ),
      );
      rerender(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <ContactsPage />
        </QueryClientProvider>,
      );

      await waitFor(() => expect(ultimaConsulta().vista).toBe("papelera"));
      expect(await screen.findByText("Carlos Mesa")).toBeInTheDocument();
      expect(screen.getByText("ya no es cliente")).toBeInTheDocument();
      expect(screen.getByText("Archivada")).toBeInTheDocument();
    });

    it("restaurar devuelve el contacto y lo dice", async () => {
      window.history.replaceState(null, "", "/dashboard/contacts?vista=papelera");
      getListadoDeContactos.mockResolvedValue(
        listado([
          fila({
            id: "c2",
            nombre: "Carlos Mesa",
            archivadoEn: new Date().toISOString(),
          }),
        ]),
      );
      renderPage();

      await userEvent.click(
        await screen.findByRole("button", { name: /Restaurar/ }),
      );

      await waitFor(() => expect(restoreContact).toHaveBeenCalledWith("c2"));
      expect(
        await screen.findByText(/volvió a los contactos activos/i),
      ).toBeInTheDocument();
    });

    it("un contacto anonimizado no se restaura ni se vuelve a eliminar", async () => {
      window.history.replaceState(null, "", "/dashboard/contacts?vista=papelera");
      getListadoDeContactos.mockResolvedValue(
        listado([
          fila({
            id: "c3",
            nombre: "Contacto anonimizado",
            archivadoEn: new Date().toISOString(),
            anonimizado: true,
          }),
        ]),
      );
      renderPage();

      await screen.findByText(/Datos personales eliminados/i);
      expect(screen.queryByRole("button", { name: /Restaurar/ })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Eliminar definitivamente/i }),
      ).toBeNull();
    });
  });

  describe("búsqueda", () => {
    it("la resuelve el SERVIDOR y queda en la URL", async () => {
      const { rerender } = renderPage();
      await screen.findByText("Ana Restrepo");

      await userEvent.type(
        screen.getByRole("searchbox", { name: /Buscar contactos/i }),
        "zubi",
      );

      await waitFor(() => expect(query().get("q")).toBe("zubi"));

      rerender(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <ContactsPage />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(ultimaConsulta().search).toBe("zubi"));
    });

    it("busca DENTRO de la papelera sin salirse de la pestaña", async () => {
      window.history.replaceState(
        null,
        "",
        "/dashboard/contacts?vista=papelera&q=mesa",
      );
      renderPage();

      await waitFor(() => {
        expect(ultimaConsulta().vista).toBe("papelera");
        expect(ultimaConsulta().search).toBe("mesa");
      });
    });

    it("sin resultados dice que es la BÚSQUEDA, no que no haya contactos", async () => {
      window.history.replaceState(null, "", "/dashboard/contacts?q=nadie");
      getListadoDeContactos.mockResolvedValue(
        listado([], { contadores: { activos: 7, archivados: 2 } }),
      );
      renderPage();

      expect(
        await screen.findByText(/Ningún contacto coincide con la búsqueda/i),
      ).toBeInTheDocument();
    });

    it("sin contactos y sin búsqueda, el mensaje es otro", async () => {
      getListadoDeContactos.mockResolvedValue(
        listado([], { contadores: { activos: 0, archivados: 0 } }),
      );
      renderPage();

      expect(
        await screen.findByText(/No hay contactos todavía/i),
      ).toBeInTheDocument();
    });
  });

  describe("archivar", () => {
    it("pide confirmación en un DIÁLOGO real y promete que el historial se conserva", async () => {
      // Antes era `window.confirm`: un modal del navegador que ni se puede
      // maquetar, ni leer con lector de pantalla como parte de la página, ni
      // conducir desde una QA automatizada.
      renderPage();
      await userEvent.click(
        await screen.findByRole("button", { name: /Archivar a Ana Restrepo/i }),
      );

      const dialogo = await screen.findByRole("dialog");
      expect(dialogo).toHaveTextContent(/¿Archivar a Ana Restrepo\?/);
      expect(dialogo).toHaveTextContent(/No se elimina su historial/i);
      expect(dialogo).toHaveTextContent(/conversaciones/i);
      expect(archiveContact).not.toHaveBeenCalled();
    });

    it("cancelar NO archiva", async () => {
      renderPage();
      await userEvent.click(
        await screen.findByRole("button", { name: /Archivar a Ana Restrepo/i }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "Cancelar" }),
      );

      expect(archiveContact).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("confirmar archiva y lo dice", async () => {
      renderPage();
      await userEvent.click(
        await screen.findByRole("button", { name: /Archivar a Ana Restrepo/i }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "Archivar" }),
      );

      await waitFor(() => expect(archiveContact).toHaveBeenCalledWith("c1"));
      expect(
        await screen.findByText(/Puedes restaurarlo desde la papelera/i),
      ).toBeInTheDocument();
    });

    it("un doble clic en confirmar archiva UNA sola vez", async () => {
      renderPage();
      await userEvent.click(
        await screen.findByRole("button", { name: /Archivar a Ana Restrepo/i }),
      );
      const confirmar = await screen.findByRole("button", { name: "Archivar" });

      fireEvent.click(confirmar);
      fireEvent.click(confirmar);

      await waitFor(() => expect(archiveContact).toHaveBeenCalledTimes(1));
    });

    it("si ya estaba archivado, lo dice en vez de fingir que hizo algo", async () => {
      archiveContact.mockResolvedValue({ archivado: false, yaEstaba: true });
      renderPage();
      await userEvent.click(
        await screen.findByRole("button", { name: /Archivar a Ana Restrepo/i }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "Archivar" }),
      );

      expect(
        await screen.findByText(/ya estaba archivado/i),
      ).toBeInTheDocument();
    });
  });

  describe("estado navegable y recargable", () => {
    it("una URL profunda se abre tal cual, sin pasar por «activos»", async () => {
      window.history.replaceState(
        null,
        "",
        "/dashboard/contacts?vista=papelera&q=mesa&pagina=2&porPagina=50",
      );
      renderPage();

      await waitFor(() => {
        const c = ultimaConsulta();
        expect(c.vista).toBe("papelera");
        expect(c.search).toBe("mesa");
        expect(c.limit).toBe(50);
        // Página 2 con 50 por página → se saltan los 50 primeros.
        expect(c.offset).toBe(50);
      });
    });

    it("cambiar de pestaña CONSERVA la fusión abierta", async () => {
      // El códec trabaja sobre la query existente justo por esto: rehacerla
      // desde cero cerraba el modal de fusión al tocar una pestaña.
      window.history.replaceState(
        null,
        "",
        "/dashboard/contacts?fusionar=c1&paso=comparar",
      );
      renderPage();
      await screen.findByText("Ana Restrepo");

      await userEvent.click(screen.getByRole("tab", { name: /Papelera/ }));

      expect(query().get("vista")).toBe("papelera");
      expect(query().get("fusionar")).toBe("c1");
      expect(query().get("paso")).toBe("comparar");
    });

    it("la paginación enseña el rango real y avanza por la URL", async () => {
      getListadoDeContactos.mockResolvedValue(
        listado([fila()], {
          total: 60,
          contadores: { activos: 60, archivados: 0 },
        }),
      );
      renderPage();

      expect(await screen.findByText(/Mostrando/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
      expect(query().get("pagina")).toBe("2");
    });
  });

  describe("estados y permisos", () => {
    it("un error se anuncia como error", async () => {
      getListadoDeContactos.mockRejectedValue(new Error("red caída"));
      renderPage();

      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });

    it("un 403 NO es un error: es falta de permiso, y no invita a reintentar", async () => {
      getListadoDeContactos.mockRejectedValue({
        response: { status: 403, data: { message: "prohibido" } },
      });
      renderPage();

      expect(
        await screen.findByText(/No tienes permiso para ver esto/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("un AGENT no ve la eliminación definitiva", async () => {
      rol = "AGENT";
      window.history.replaceState(null, "", "/dashboard/contacts?vista=papelera");
      getListadoDeContactos.mockResolvedValue(
        listado([
          fila({ id: "c2", archivadoEn: new Date().toISOString() }),
        ]),
      );
      renderPage();

      await screen.findByRole("button", { name: /Restaurar/ });
      expect(
        screen.queryByRole("button", { name: /Eliminar definitivamente/i }),
      ).toBeNull();
    });
  });

  describe("regresión de la fusión de duplicados (3.x)", () => {
    it("un ADMIN la abre y la pareja queda en la URL", async () => {
      renderPage();
      await userEvent.click(
        await screen.findByRole("button", {
          name: /Fusionar duplicado de Ana Restrepo/,
        }),
      );

      expect(query().get("fusionar")).toBe("c1");
    });

    it("un AGENT no ve la acción de fusionar", async () => {
      rol = "AGENT";
      renderPage();

      await screen.findByText("Ana Restrepo");
      expect(
        screen.queryAllByRole("button", { name: /Fusionar duplicado/ }),
      ).toHaveLength(0);
    });

    it("un enlace a un contacto ABSORBIDO se reescribe por el canónico", async () => {
      window.history.replaceState(
        null,
        "",
        "/dashboard/contacts?fusionar=viejo&con=otro",
      );
      getCanonico.mockResolvedValue({
        solicitado: "viejo",
        canonicoId: "c1",
        fueFusionado: true,
        fusionadoEn: new Date().toISOString(),
      });

      renderPage();

      await waitFor(() => expect(query().get("fusionar")).toBe("c1"));
      expect(query().get("con")).toBeNull();
    });

    it("un id que NO fue absorbido no provoca redirección: sin bucles", async () => {
      window.history.replaceState(null, "", "/dashboard/contacts?fusionar=c1");
      renderPage();

      await screen.findByText("Ana Restrepo");
      await waitFor(() => expect(getCanonico).toHaveBeenCalledWith("c1"));
      expect(query().get("fusionar")).toBe("c1");
    });
  });
});
