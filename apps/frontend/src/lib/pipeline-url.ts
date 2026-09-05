/**
 * La URL del Pipeline: qué embudo, qué tarjeta y qué se está filtrando.
 *
 * MISMA LECCIÓN QUE CONTACTOS (3.z) Y LA BANDEJA (3.y), Y AQUÍ SEGUÍA SIN
 * APLICARSE. La pantalla del embudo navegaba con `router.replace`, y en el
 * build de producción un cambio que solo toca la query no llega a aplicarse:
 * la barra de direcciones se queda igual, así que recargar devolvía al embudo
 * predeterminado y sin panel —justo lo que el comentario de la pantalla decía
 * que estaba resuelto—. Next 15+ sí observa `history.pushState`/`replaceState`,
 * y `useSearchParams` se actualiza con ellos.
 *
 * Funciones puras y fuera de la pantalla: así se comprueba qué sobrevive a
 * una recarga sin montar el tablero entero.
 */
import {
  formatearDinero,
  REGION_POR_DEFECTO,
  type RegionDeMoneda,
} from "./dinero";

import type { KanbanStage, Lead } from "@/types";

export interface EstadoDePipeline {
  /** Embudo seleccionado. `null` = el predeterminado. */
  embudo: string | null;
  /** Oportunidad con el detalle abierto (modal). */
  lead: string | null;
  /** Contacto con el panel lateral abierto. */
  perfil: string | null;
  /** Tarjeta seleccionada en el tablero. Es lo que se ve resaltado. */
  seleccion: string | null;
  /** Texto del buscador de oportunidades. */
  q: string;
  /** Responsable por el que se filtra. `sin` = las que no tienen. */
  asesor: string | null;
  /** Etapas plegadas. El resto están desplegadas. */
  plegadas: string[];
}

export function leerEstadoDePipeline(
  params: URLSearchParams,
): EstadoDePipeline {
  const plegadas = (params.get("plegadas") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    embudo: params.get("embudo") || null,
    lead: params.get("lead") || null,
    perfil: params.get("perfil") || null,
    seleccion: params.get("sel") || null,
    q: (params.get("q") ?? "").trim(),
    asesor: params.get("asesor") || null,
    // Sin duplicados: una etapa plegada dos veces en la barra de direcciones
    // no es un estado distinto.
    plegadas: [...new Set(plegadas)],
  };
}

export interface CambiosDePipeline {
  embudo?: string | null;
  lead?: string | null;
  perfil?: string | null;
  seleccion?: string | null;
  q?: string;
  asesor?: string | null;
  plegadas?: string[];
}

/**
 * Aplica un cambio SOBRE la query actual y devuelve la nueva.
 *
 * Trabaja sobre la que ya hay en vez de reconstruirla: si mañana esta pantalla
 * comparte parámetros con otra cosa —como le pasó a Contactos con la fusión—,
 * teclear en el buscador no se los lleva por delante.
 *
 * Cambiar de embudo LIMPIA la selección, el panel y el detalle: pertenecen a
 * otro tablero, y dejarlos abiertos enseña la ficha de una oportunidad que ya
 * no está en pantalla.
 */
export function aplicarEnPipeline(
  actual: URLSearchParams,
  cambios: CambiosDePipeline,
): string {
  const q = new URLSearchParams(actual.toString());

  function poner(clave: string, valor: string | null | undefined) {
    if (valor === undefined) return;
    if (valor) q.set(clave, valor);
    else q.delete(clave);
  }

  if (cambios.embudo !== undefined) {
    poner("embudo", cambios.embudo);
    q.delete("lead");
    q.delete("perfil");
    q.delete("sel");
    q.delete("plegadas");
  }

  poner("lead", cambios.lead);
  poner("perfil", cambios.perfil);
  poner("sel", cambios.seleccion);
  poner("asesor", cambios.asesor);

  if (cambios.q !== undefined) poner("q", cambios.q.trim());

  if (cambios.plegadas !== undefined) {
    const limpias = [...new Set(cambios.plegadas.filter(Boolean))];
    if (limpias.length) q.set("plegadas", limpias.join(","));
    else q.delete("plegadas");
  }

  return q.toString();
}

/** La ruta completa que representa un estado. Para `volverA` y para navegar. */
export function rutaDePipeline(query: string): string {
  return query ? `/dashboard/pipeline?${query}` : "/dashboard/pipeline";
}

// ── Cifras del tablero ──────────────────────────────────────────────
//
// Se calculan aquí, sobre la MISMA respuesta que dibuja las tarjetas, y no en
// una consulta aparte. Con dos orígenes distintos la cabecera acabaría
// diciendo 30 oportunidades mientras se ven 28 sobre el tablero, y quien lo
// mira no tiene forma de saber cuál de las dos miente.

export interface ResumenDelEmbudo {
  oportunidades: number;
  valor: number;
  sinResponsable: number;
}

export function resumenDelEmbudo(stages: KanbanStage[]): ResumenDelEmbudo {
  return stages.reduce<ResumenDelEmbudo>(
    (acc, etapa) => ({
      oportunidades: acc.oportunidades + etapa.leads.length,
      valor: acc.valor + (etapa.totalValue ?? 0),
      sinResponsable:
        acc.sinResponsable + etapa.leads.filter((l) => !l.agent).length,
    }),
    { oportunidades: 0, valor: 0, sinResponsable: 0 },
  );
}

/** Los responsables que aparecen en el tablero, para poder filtrar por ellos. */
export function asesoresDelEmbudo(
  stages: KanbanStage[],
): Array<{ id: string; nombre: string }> {
  const vistos = new Map<string, string>();
  for (const etapa of stages) {
    for (const lead of etapa.leads) {
      if (lead.agent) vistos.set(lead.agent.id, lead.agent.name);
    }
  }
  return [...vistos.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function coincide(lead: Lead, texto: string): boolean {
  if (!texto) return true;
  const aguja = texto.toLocaleLowerCase("es");
  return [lead.title, lead.contact.name, lead.contact.phone, lead.agent?.name]
    .filter((campo): campo is string => !!campo)
    .some((campo) => campo.toLocaleLowerCase("es").includes(aguja));
}

/**
 * Filtra las tarjetas SIN vaciar el tablero de etapas.
 *
 * Las etapas se quedan todas, aunque ninguna de sus oportunidades pase el
 * filtro: el embudo es la estructura del proceso comercial, y esconder
 * «Ganado» porque hoy no hay nada ganado deja al usuario creyendo que esa
 * etapa no existe. Lo que se recalcula es la cifra y el importe de cada una,
 * para que cabecera y tarjetas cuenten lo mismo.
 */
export function filtrarEtapas(
  stages: KanbanStage[],
  filtro: { q: string; asesor: string | null },
): KanbanStage[] {
  if (!filtro.q && !filtro.asesor) return stages;

  return stages.map((etapa) => {
    const leads = etapa.leads.filter((lead) => {
      if (!coincide(lead, filtro.q)) return false;
      if (!filtro.asesor) return true;
      if (filtro.asesor === "sin") return !lead.agent;
      return lead.agent?.id === filtro.asesor;
    });

    return {
      ...etapa,
      leads,
      leadCount: leads.length,
      totalValue: leads.reduce((suma, l) => suma + (l.value ?? 0), 0),
    };
  });
}

// ── Formato ─────────────────────────────────────────────────────────

/**
 * Importe COMPLETO, nunca abreviado.
 *
 * El mockup escribe «$12,4 M» en las cabeceras. Abreviar redondea, y con un
 * total arriba y cinco importes debajo el redondeo se ve: la suma de lo que
 * está escrito deja de dar el total que también está escrito. En un tablero de
 * ventas eso es exactamente lo que hace que nadie se fíe de la cifra.
 */
export function moneda(
  valor: number | null | undefined,
  region: RegionDeMoneda = REGION_POR_DEFECTO,
): string {
  return formatearDinero(valor, region);
}

/** «10:23», «ayer», «12 ago». Fecha del dato, nunca una inventada. */
export function cuando(iso: string | null | undefined): string {
  if (!iso) return "sin fecha";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "sin fecha";

  const dia = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(fecha)) / 86_400_000);

  if (dias === 0) {
    return fecha.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (dias === 1) return "ayer";
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}
