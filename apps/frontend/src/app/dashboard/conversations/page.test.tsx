import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConversationsPage from "./page";

/**
 * EL INBOX DE TRES PANELES (mockup 03).
 *
 * Lo que se fija aquí es el comportamiento que la revisión humana va a probar:
 * que la URL manda —recargar y Atrás devuelven lo mismo que había—, que un
 * enlace profundo a una conversación que no está en la página cargada abre el
 * hilo igual, y que abrir o cerrar la ficha NO cambia la conversación.
 *
 * La navegación se simula con una URL de verdad, no con un espía suelto: lo
 * que se quiere comprobar es qué queda escrito en la barra de direcciones.
 */

let urlActual = "/dashboard/conversations";
const historial: string[] = [];

const push = vi.fn((url: string) => {
  historial.push(urlActual);
  urlActual = url;
});
const replace = vi.fn((url: string) => {
  urlActual = url;
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => urlActual.split("?")[0],
  useSearchParams: () => new URLSearchParams(urlActual.split("?")[1] ?? ""),
}));

const getInbox = vi.fn();
const getInboxCounters = vi.fn();
const getConversation = vi.fn();
const getMessages = vi.fn();
const markConversationRead = vi.fn();

vi.mock("@/lib/conversations", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/conversations")>(
      "@/lib/conversations",
    );
  return {
    ...real,
    getInbox: (f: unknown) => getInbox(f),
    getInboxCounters: () => getInboxCounters(),
    getConversation: (id: string) => getConversation(id),
    getMessages: (id: string) => getMessages(id),
    markConversationRead: (id: string) => markConversationRead(id),
    sendMessage: vi.fn(),
    pauseConversation: vi.fn(),
    resumeConversation: vi.fn(),
    bulkConversations: vi.fn(),
  };
});
vi.mock("@/lib/users", () => ({ getCompanyUsers: () => Promise.resolve([]) }));
vi.mock("@/lib/use-realtime", () => ({
  useRealtime: () => ({ enVivo: false }),
  intervaloDeRefresco: () => false,
}));
vi.mock("@/lib/perfil", async () => {
  const real = await vi.importActual<typeof import("@/lib/perfil")>(
    "@/lib/perfil",
  );
  return {
    ...real,
    getPerfilComercial: () =>
      Promise.resolve({
        contacto: {
          id: "k1",
          nombre: "Laura Martínez",
          telefono: "+573001110004",
          email: null,
          etiquetas: [],
          bloqueado: false,
          archivadoEn: null,
          motivoDeArchivo: null,
          anonimizado: false,
          creadoEn: new Date().toISOString(),
        },
        empresa: { id: "e1", nombre: "Muebles del Valle" },
        oportunidad: null,
        conversacion: null,
        tareasPendientes: [],
        cotizaciones: [],
        camposPersonalizados: [],
        pulso: null,
        actividad: [],
      }),
  };
});
vi.mock("@/components/tasks/SugerenciasDeTarea", () => ({
  SugerenciasDeTarea: () => null,
}));
vi.mock("@/components/conversations/ConversationOpportunity", () => ({
  ConversationOpportunity: () => null,
}));

const conversacion = (extra: Record<string, unknown> = {}) => ({
  id: "conv-1",
  status: "OPEN",
  stage: null,
  isPaused: false,
  channel: "whatsapp",
  lastMessageAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  contact: { id: "k1", name: "Laura Martínez", phone: "+573001110004" },
  agent: null,
  lead: null,
  messages: [],
  unreadCount: 0,
  lastReadAt: null,
  ...extra,
});

function montar(url = "/dashboard/conversations") {
  urlActual = url;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConversationsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  historial.length = 0;
  getInbox.mockResolvedValue({
    items: [conversacion(), conversacion({ id: "conv-2", contact: { id: "k2", name: "Juan Camilo", phone: "+573001110005" } })],
    hasMore: false,
  });
  getInboxCounters.mockResolvedValue({
    total: 2,
    mine: 1,
    unassigned: 1,
    unread: 0,
  });
  getMessages.mockResolvedValue([
    {
      id: "m1",
      body: "Hola, buen día",
      type: "TEXT",
      direction: "INBOUND",
      status: "RECEIVED",
      createdAt: new Date().toISOString(),
    },
  ]);
  markConversationRead.mockResolvedValue({});
  getConversation.mockRejectedValue({ response: { status: 404 } });
});

describe("Inbox — los tres paneles", () => {
  it("sin selección se ve la bandeja y una invitación a elegir", async () => {
    montar();

    expect(
      await screen.findByRole("button", { name: /laura martínez/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/elige una conversación/i)).toBeInTheDocument();
  });

  it("el título lleva el contador real de la empresa", async () => {
    montar();
    const cabecera = await screen.findByRole("heading", {
      name: "Conversaciones",
    });
    await waitFor(() => expect(cabecera.parentElement).toHaveTextContent("2"));
  });

  it("la ficha no se monta hasta que se pide", async () => {
    montar("/dashboard/conversations?c=conv-1");
    await screen.findByRole("log");
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("Inbox — la URL manda", () => {
  it("elegir una conversación la escribe en la URL", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(
      await screen.findByRole("button", { name: /laura martínez/i }),
    );

    expect(push).toHaveBeenCalledWith(
      "/dashboard/conversations?c=conv-1",
      expect.anything(),
    );
  });

  it("una URL con conversación abre el hilo directamente, sin clic", async () => {
    montar("/dashboard/conversations?c=conv-1");
    expect(await screen.findByRole("log")).toBeInTheDocument();
  });

  it("recargar con filtros los conserva: la pestaña activa sale de la URL", async () => {
    montar("/dashboard/conversations?vista=sinleer");
    const boton = await screen.findByRole("button", { name: /sin leer/i });
    expect(boton).toHaveAttribute("aria-current", "true");
  });

  it("la búsqueda de la URL llega al campo y al contrato", async () => {
    montar("/dashboard/conversations?q=laura");
    await waitFor(() =>
      expect(getInbox).toHaveBeenCalledWith(
        expect.objectContaining({ search: "laura" }),
      ),
    );
    expect(screen.getByLabelText(/buscar conversaciones/i)).toHaveValue("laura");
  });

  it("cambiar de pestaña conserva la conversación abierta", async () => {
    const user = userEvent.setup();
    montar("/dashboard/conversations?c=conv-1");

    await user.click(await screen.findByRole("button", { name: /^mías/i }));

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("c=conv-1"),
      expect.anything(),
    );
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("vista=mias"),
      expect.anything(),
    );
  });

  it("cada selección deja una entrada de historial, para que Atrás funcione", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(
      await screen.findByRole("button", { name: /laura martínez/i }),
    );

    expect(historial).toContain("/dashboard/conversations");
  });

  it("el filtro de estado viaja al contrato", async () => {
    montar("/dashboard/conversations?estado=ARCHIVED");
    await waitFor(() =>
      expect(getInbox).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ARCHIVED" }),
      ),
    );
  });
});

describe("Inbox — enlace profundo a algo que no está en la lista", () => {
  it("pide la conversación suelta y abre el hilo igual", async () => {
    getInbox.mockResolvedValue({ items: [conversacion()], hasMore: false });
    getConversation.mockResolvedValue(
      conversacion({
        id: "conv-99",
        contact: { id: "k9", name: "Archivada Vieja", phone: "+573001119999" },
      }),
    );

    montar("/dashboard/conversations?c=conv-99");

    await waitFor(() => expect(getConversation).toHaveBeenCalledWith("conv-99"));
    expect(await screen.findByText("Archivada Vieja")).toBeInTheDocument();
  });

  it("una conversación de otra empresa da un estado seguro, no un hilo vacío", async () => {
    getConversation.mockRejectedValue({ response: { status: 404 } });
    montar("/dashboard/conversations?c=de-otro-tenant");

    expect(
      await screen.findByText(/ya no está disponible/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("sin permiso lo dice como permiso, no como avería", async () => {
    getConversation.mockRejectedValue({ response: { status: 403 } });
    montar("/dashboard/conversations?c=conv-77");

    expect(
      await screen.findByText(/no puedes ver esta conversación/i),
    ).toBeInTheDocument();
  });
});

describe("Inbox — estados de la lista", () => {
  it("mientras carga no dice que no hay nada", async () => {
    getInbox.mockReturnValue(new Promise(() => {}));
    montar();
    expect(
      await screen.findByText(/cargando conversaciones/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/todavía no hay conversaciones/i)).toBeNull();
  });

  it("un error se distingue de una bandeja vacía", async () => {
    getInbox.mockRejectedValue(new Error("caída"));
    montar();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/todavía no hay conversaciones/i)).toBeNull();
  });

  it("un 403 en la bandeja se cuenta como permiso", async () => {
    getInbox.mockRejectedValue({ response: { status: 403 } });
    montar();
    expect(
      await screen.findByText(/no puedes ver esta bandeja/i),
    ).toBeInTheDocument();
  });

  it("vacío por filtros y vacío de verdad no dicen lo mismo", async () => {
    getInbox.mockResolvedValue({ items: [], hasMore: false });
    montar("/dashboard/conversations?q=zzz");
    expect(await screen.findByText(/ninguna conversación coincide/i)).toBeInTheDocument();
  });

  it("con más páginas ofrece cargar más, y no lo hace solo", async () => {
    getInbox.mockResolvedValue({ items: [conversacion()], hasMore: true });
    const user = userEvent.setup();
    montar();

    const boton = await screen.findByRole("button", { name: /cargar más/i });
    getInbox.mockClear();
    await user.click(boton);

    await waitFor(() =>
      expect(getInbox).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 60 }),
      ),
    );
  });
});

describe("Inbox — la ficha del contacto", () => {
  it("abrir la ficha NO cambia la conversación", async () => {
    const user = userEvent.setup();
    montar("/dashboard/conversations?c=conv-1");

    await user.click(
      await screen.findByRole("button", { name: /ver la ficha/i }),
    );

    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("c=conv-1"),
      expect.anything(),
    );
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("perfil=1"),
      expect.anything(),
    );
  });

  it("con la ficha abierta en la URL, el panel se monta", async () => {
    montar("/dashboard/conversations?c=conv-1&perfil=1");
    expect(
      await screen.findByRole("complementary", { name: /perfil del contacto/i }),
    ).toBeInTheDocument();
  });

  it("cerrar la ficha conserva la conversación", async () => {
    const user = userEvent.setup();
    montar("/dashboard/conversations?c=conv-1&perfil=1");

    await user.click(
      await screen.findByRole("button", { name: /cerrar el perfil/i }),
    );

    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("c=conv-1"),
      expect.anything(),
    );
    expect(replace).not.toHaveBeenCalledWith(
      expect.stringContaining("perfil=1"),
      expect.anything(),
    );
  });

  it("el perfil completo se enlaza con la ruta de regreso al MISMO hilo", async () => {
    montar("/dashboard/conversations?c=conv-1&perfil=1");

    const enlace = await screen.findByRole("link", {
      name: /ver perfil completo/i,
    });
    expect(enlace).toHaveAttribute(
      "href",
      expect.stringContaining("/dashboard/contacts/k1"),
    );
    expect(enlace.getAttribute("href")).toContain(
      encodeURIComponent("c=conv-1"),
    );
  });
});

describe("Inbox — lectura", () => {
  it("abrir un hilo lo marca leído, venga de donde venga la selección", async () => {
    montar("/dashboard/conversations?c=conv-1");
    await waitFor(() =>
      expect(markConversationRead).toHaveBeenCalledWith("conv-1"),
    );
  });

  it("sin conversación no marca nada", async () => {
    montar();
    await screen.findByRole("button", { name: /laura martínez/i });
    expect(markConversationRead).not.toHaveBeenCalled();
  });
});
