import { describe, expect, it } from "vitest";
import {
  POR_PAGINA_POR_DEFECTO,
  aplicarEnQuery,
  leerEstadoDeContactos,
  offsetDe,
  rangoMostrado,
  rutaDeContactos,
  totalDePaginas,
} from "./contactos-url";

const leer = (q: string) => leerEstadoDeContactos(new URLSearchParams(q));
const aplicar = (q: string, cambios: Parameters<typeof aplicarEnQuery>[1]) =>
  new URLSearchParams(aplicarEnQuery(new URLSearchParams(q), cambios));

describe("leerEstadoDeContactos", () => {
  it("sin parámetros, activos y primera página", () => {
    expect(leer("")).toEqual({
      vista: "activos",
      search: "",
      pagina: 1,
      porPagina: POR_PAGINA_POR_DEFECTO,
    });
  });

  it("lee pestaña, búsqueda, página y tamaño", () => {
    expect(leer("vista=papelera&q=ana&pagina=3&porPagina=50")).toEqual({
      vista: "papelera",
      search: "ana",
      pagina: 3,
      porPagina: 50,
    });
  });

  it("una vista inventada cae en «activos», no en una lista vacía", () => {
    // Una lista vacía por un parámetro mal escrito parecería que no hay
    // contactos, y nadie relacionaría eso con la barra de direcciones.
    expect(leer("vista=loquesea").vista).toBe("activos");
  });

  it("una página o un tamaño imposibles no rompen la primera carga", () => {
    // El backend rechaza `limit > 100` con un 400: dejar pasar el valor
    // dejaría la pantalla en error por algo que nadie escribió a mano.
    expect(leer("pagina=0").pagina).toBe(1);
    expect(leer("pagina=-4").pagina).toBe(1);
    expect(leer("pagina=abc").pagina).toBe(1);
    expect(leer("porPagina=9999").porPagina).toBe(POR_PAGINA_POR_DEFECTO);
    expect(leer("porPagina=7").porPagina).toBe(POR_PAGINA_POR_DEFECTO);
  });

  it("la búsqueda llega recortada", () => {
    expect(leer("q=%20%20ana%20%20").search).toBe("ana");
  });
});

describe("aplicarEnQuery", () => {
  it("«activos» no se escribe: la lista limpia deja la URL limpia", () => {
    expect(aplicarEnQuery(new URLSearchParams("vista=papelera"), {
      vista: "activos",
    })).toBe("");
  });

  it("CONSERVA los parámetros de la fusión al cambiar de pestaña", () => {
    // La razón de que este códec trabaje sobre la query existente en vez de
    // rehacerla: reconstruirla cerraba el modal de fusión de 3.x al tocar una
    // pestaña o al teclear en el buscador.
    const q = aplicar("fusionar=c1&con=c2&paso=comparar", {
      vista: "papelera",
    });
    expect(q.get("vista")).toBe("papelera");
    expect(q.get("fusionar")).toBe("c1");
    expect(q.get("con")).toBe("c2");
    expect(q.get("paso")).toBe("comparar");
  });

  it("buscar vuelve a la página 1", () => {
    // Conservar «página 7» al buscar deja la lista vacía con resultados que
    // sí existen, y no hay forma de que se entienda por qué.
    const q = aplicar("pagina=7", { search: "ana" });
    expect(q.get("q")).toBe("ana");
    expect(q.get("pagina")).toBeNull();
  });

  it("cambiar de pestaña o de tamaño también vuelve a la página 1", () => {
    expect(aplicar("pagina=5", { vista: "papelera" }).get("pagina")).toBeNull();
    expect(aplicar("pagina=5", { porPagina: 100 }).get("pagina")).toBeNull();
  });

  it("una búsqueda vacía borra el parámetro en vez de dejar `q=`", () => {
    expect(aplicar("q=ana", { search: "   " }).get("q")).toBeNull();
  });

  it("la página 1 no se escribe", () => {
    expect(aplicar("pagina=4", { pagina: 1 }).get("pagina")).toBeNull();
    expect(aplicar("", { pagina: 3 }).get("pagina")).toBe("3");
  });

  it("el tamaño por defecto no se escribe", () => {
    expect(
      aplicar("porPagina=50", { porPagina: POR_PAGINA_POR_DEFECTO }).get(
        "porPagina",
      ),
    ).toBeNull();
  });
});

describe("paginación", () => {
  const estado = (pagina: number, porPagina = 25) => ({
    vista: "activos" as const,
    search: "",
    pagina,
    porPagina,
  });

  it("el offset sale del número de página", () => {
    expect(offsetDe(estado(1))).toBe(0);
    expect(offsetDe(estado(2))).toBe(25);
    expect(offsetDe(estado(3, 50))).toBe(100);
  });

  it("el rango mostrado es el de verdad, no el del tamaño de página", () => {
    // Última página incompleta: «Mostrando 51 a 60 de 60», no «51 a 75».
    expect(rangoMostrado(estado(3), 10, 60)).toEqual({
      desde: 51,
      hasta: 60,
      total: 60,
    });
  });

  it("sin resultados no se enseña un rango falso", () => {
    expect(rangoMostrado(estado(1), 0, 0)).toEqual({
      desde: 0,
      hasta: 0,
      total: 0,
    });
  });

  it("siempre hay al menos una página, aunque no haya nada", () => {
    expect(totalDePaginas(estado(1), 0)).toBe(1);
    expect(totalDePaginas(estado(1), 60)).toBe(3);
    expect(totalDePaginas(estado(1), 50)).toBe(2);
  });
});

describe("rutaDeContactos", () => {
  it("sin query no deja un «?» colgando", () => {
    expect(rutaDeContactos("")).toBe("/dashboard/contacts");
  });

  it("con query la compone entera, que es lo que va en `volverA`", () => {
    expect(rutaDeContactos("vista=papelera&q=ana")).toBe(
      "/dashboard/contacts?vista=papelera&q=ana",
    );
  });
});
