import { describe, expect, it } from "vitest";
import { intervaloDeRefresco, POLL_EN_VIVO_MS, POLL_SIN_CANAL_MS } from "./use-realtime";
import { EVENTS, EVENT_VERSION, realtimeUrl } from "./realtime";

describe("realtimeUrl", () => {
  it("recorta el sufijo /api: el namespace cuelga de la raíz del host", () => {
    expect(realtimeUrl("https://api.ejemplo.com/api")).toBe(
      "https://api.ejemplo.com",
    );
    expect(realtimeUrl("https://api.ejemplo.com/api/")).toBe(
      "https://api.ejemplo.com",
    );
  });

  it("deja intacta una URL sin /api", () => {
    expect(realtimeUrl("https://api.ejemplo.com")).toBe(
      "https://api.ejemplo.com",
    );
  });

  it("sin URL configurada devuelve null en vez de intentar conectar a nada", () => {
    expect(realtimeUrl(undefined)).toBeNull();
    expect(realtimeUrl("")).toBeNull();
  });
});

describe("nombres de evento", () => {
  it("todos llevan la versión delante, igual que en el backend", () => {
    // Si el backend y el cliente se desincronizan aquí, no falla nada: deja de
    // llegar en vivo y solo se nota en producción. Por eso se fija.
    for (const evento of Object.values(EVENTS)) {
      expect(evento.startsWith(`${EVENT_VERSION}:`)).toBe(true);
    }
  });

  it("los nombres son exactamente los que emite el backend", () => {
    expect(EVENTS.MESSAGE_CREATED).toBe("v1:message.created");
    expect(EVENTS.MESSAGE_STATUS_CHANGED).toBe("v1:message.status_changed");
    expect(EVENTS.CONVERSATION_UPDATED).toBe("v1:conversation.updated");
    expect(EVENTS.LEAD_UPDATED).toBe("v1:lead.updated");
    expect(EVENTS.TASK_UPDATED).toBe("v1:task.updated");
    expect(EVENTS.NOTIFICATION_CREATED).toBe("v1:notification.created");
  });
});

describe("respaldo por polling", () => {
  it("con canal abierto refresca más despacio, pero NUNCA deja de refrescar", () => {
    // Quitarlo del todo convertiría el WebSocket en punto único de fallo: su
    // caída se vería como "el CRM no actualiza", que casi nadie diagnostica.
    expect(intervaloDeRefresco(true)).toBe(POLL_EN_VIVO_MS);
    expect(intervaloDeRefresco(true)).toBeGreaterThan(0);
  });

  it("sin canal vuelve al ritmo de siempre", () => {
    expect(intervaloDeRefresco(false)).toBe(POLL_SIN_CANAL_MS);
  });

  it("el ritmo en vivo es más lento que el de respaldo", () => {
    expect(intervaloDeRefresco(true)).toBeGreaterThan(intervaloDeRefresco(false));
  });
});
