import { describe, expect, it } from "vitest";
import {
  aplicarEnPipeline,
  asesoresDelEmbudo,
  cuando,
  filtrarEtapas,
  leerEstadoDePipeline,
  moneda,
  resumenDelEmbudo,
  rutaDePipeline,
} from "./pipeline-url";
import type { KanbanStage, Lead } from "@/types";

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    title: "Sala Toscana para terraza",
    value: 12_400_000,
    status: "OPEN",
    lostReason: null,
    expectedCloseDate: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    contactId: "c1",
    contact: { id: "c1", name: "Laura Martínez", phone: "+573001110001" },
    pipelineId: "p1",
    stageId: "s1",
    assignedTo: "u1",
    agent: { id: "u1", name: "Ana Administradora" },
    ...over,
  };
}

function etapa(over: Partial<KanbanStage> = {}): KanbanStage {
  const leads = over.leads ?? [lead()];
  return {
    id: "s1",
    name: "Nuevo",
    order: 0,
    color: "#2A5FD6",
    leadCount: leads.length,
    totalValue: leads.reduce((s, l) => s + (l.value ?? 0), 0),
    ...over,
    leads,
  };
}

describe("leerEstadoDePipeline", () => {
  it("sin parámetros deja el embudo predeterminado y todo desplegado", () => {
    const e = leerEstadoDePipeline(new URLSearchParams());
    expect(e.embudo).toBeNull();
    expect(e.plegadas).toEqual([]);
    expect(e.q).toBe("");
  });

  it("lee embudo, selección, ficha, detalle, filtros y etapas plegadas", () => {
    const e = leerEstadoDePipeline(
      new URLSearchParams(
        "embudo=p1&sel=l9&perfil=c9&lead=l9&q=  sala &asesor=u1&plegadas=s2,s3",
      ),
    );
    expect(e).toMatchObject({
      embudo: "p1",
      seleccion: "l9",
      perfil: "c9",
      lead: "l9",
      q: "sala",
      asesor: "u1",
      plegadas: ["s2", "s3"],
    });
  });

  it("una etapa repetida en la URL no es un estado distinto", () => {
    const e = leerEstadoDePipeline(new URLSearchParams("plegadas=s2,s2,,s3"));
    expect(e.plegadas).toEqual(["s2", "s3"]);
  });
});

describe("aplicarEnPipeline", () => {
  it("cambiar de embudo cierra ficha, detalle y selección del anterior", () => {
    const q = aplicarEnPipeline(
      new URLSearchParams("embudo=p1&perfil=c1&lead=l1&sel=l1&plegadas=s1"),
      { embudo: "p2" },
    );
    const e = leerEstadoDePipeline(new URLSearchParams(q));
    expect(e.embudo).toBe("p2");
    expect(e.perfil).toBeNull();
    expect(e.lead).toBeNull();
    expect(e.seleccion).toBeNull();
    expect(e.plegadas).toEqual([]);
  });

  it("conserva lo que no se toca: buscar no cierra la ficha abierta", () => {
    const q = aplicarEnPipeline(new URLSearchParams("perfil=c1&sel=l1"), {
      q: "toscana",
    });
    const e = leerEstadoDePipeline(new URLSearchParams(q));
    expect(e.perfil).toBe("c1");
    expect(e.seleccion).toBe("l1");
    expect(e.q).toBe("toscana");
  });

  it("vaciar el buscador borra el parámetro en vez de dejarlo vacío", () => {
    const q = aplicarEnPipeline(new URLSearchParams("q=sala"), { q: "   " });
    expect(q).not.toContain("q=");
  });

  it("desplegar todas las etapas deja la URL limpia", () => {
    const q = aplicarEnPipeline(new URLSearchParams("plegadas=s1,s2"), {
      plegadas: [],
    });
    expect(q).toBe("");
    expect(rutaDePipeline(q)).toBe("/dashboard/pipeline");
  });
});

describe("resumenDelEmbudo", () => {
  it("cuenta oportunidades, suma valor y señala las que no tienen responsable", () => {
    const r = resumenDelEmbudo([
      etapa({
        id: "s1",
        leads: [lead({ id: "a" }), lead({ id: "b", agent: null, value: 100 })],
      }),
      etapa({ id: "s2", name: "Cotizado", leads: [lead({ id: "c", value: 5 })] }),
    ]);

    expect(r.oportunidades).toBe(3);
    expect(r.valor).toBe(12_400_000 + 100 + 5);
    expect(r.sinResponsable).toBe(1);
  });

  it("un embudo sin oportunidades no da NaN ni cifras inventadas", () => {
    expect(resumenDelEmbudo([etapa({ leads: [] })])).toEqual({
      oportunidades: 0,
      valor: 0,
      sinResponsable: 0,
    });
  });

  it("el total es EXACTAMENTE la suma de lo que enseña cada etapa", () => {
    const etapas = [
      etapa({ id: "s1", leads: [lead({ id: "a", value: 1_234_567 })] }),
      etapa({ id: "s2", leads: [lead({ id: "b", value: 7_654_321 })] }),
    ];
    const total = resumenDelEmbudo(etapas).valor;
    expect(total).toBe(etapas[0].totalValue + etapas[1].totalValue);
    // Y lo que se lee en pantalla también cuadra: no se abrevia a «$8,9 M».
    expect(moneda(total)).toBe(moneda(8_888_888));
  });
});

describe("filtrarEtapas", () => {
  const etapas = [
    etapa({
      id: "s1",
      leads: [
        lead({ id: "a", title: "Sala Toscana" }),
        lead({
          id: "b",
          title: "Comedor Roble",
          value: 8_700_000,
          agent: null,
          contact: { id: "c2", name: "Juan Camilo", phone: "+573001110002" },
        }),
      ],
    }),
    etapa({ id: "s2", name: "Ganado", leads: [] }),
  ];

  it("sin filtro devuelve el tablero tal cual", () => {
    expect(filtrarEtapas(etapas, { q: "", asesor: null })).toBe(etapas);
  });

  it("busca por oportunidad, contacto, teléfono y responsable", () => {
    for (const aguja of ["toscana", "laura", "1110001", "ana admin"]) {
      const r = filtrarEtapas(etapas, { q: aguja, asesor: null });
      expect(r[0].leads.map((l) => l.id)).toEqual(["a"]);
    }
  });

  it("recalcula cifra e importe de la etapa, para que cabecera y tarjetas cuadren", () => {
    const r = filtrarEtapas(etapas, { q: "comedor", asesor: null });
    expect(r[0].leadCount).toBe(1);
    expect(r[0].totalValue).toBe(8_700_000);
  });

  it("«sin responsable» es un filtro de verdad, no un texto", () => {
    const r = filtrarEtapas(etapas, { q: "", asesor: "sin" });
    expect(r[0].leads.map((l) => l.id)).toEqual(["b"]);
  });

  it("NO esconde las etapas vacías: el embudo es el proceso, no el resultado", () => {
    const r = filtrarEtapas(etapas, { q: "nada de nada", asesor: null });
    expect(r).toHaveLength(2);
    expect(r[1].name).toBe("Ganado");
    expect(r.every((e) => e.leads.length === 0)).toBe(true);
  });
});

describe("asesoresDelEmbudo", () => {
  it("lista cada responsable una vez y en orden alfabético", () => {
    const r = asesoresDelEmbudo([
      etapa({
        leads: [
          lead({ id: "a", agent: { id: "u2", name: "Zulema Ríos" } }),
          lead({ id: "b" }),
          lead({ id: "c" }),
          lead({ id: "d", agent: null }),
        ],
      }),
    ]);
    expect(r).toEqual([
      { id: "u1", nombre: "Ana Administradora" },
      { id: "u2", nombre: "Zulema Ríos" },
    ]);
  });
});

describe("moneda y cuando", () => {
  it("un valor nulo es cero pesos, no «NaN»", () => {
    expect(moneda(null)).toBe(moneda(0));
    expect(moneda(undefined)).not.toMatch(/NaN/);
  });

  it("hoy da la hora; ayer lo dice; más atrás, la fecha", () => {
    const ahora = new Date();
    const ayer = new Date(ahora.getTime() - 86_400_000);
    expect(cuando(ahora.toISOString())).toMatch(/\d/);
    expect(cuando(ayer.toISOString())).toBe("ayer");
    expect(cuando("2026-01-15T12:00:00.000Z")).toMatch(/ene/i);
  });

  it("una fecha ausente o rota no imprime «Invalid Date»", () => {
    expect(cuando(null)).toBe("sin fecha");
    expect(cuando("no soy una fecha")).toBe("sin fecha");
  });
});
