/**
 * La URL de Contactos: qué se está mirando, no solo qué se abrió.
 *
 * Mismo problema y misma solución que la bandeja (3.y). Antes, la pestaña
 * —activos o papelera— y la búsqueda vivían en estado de React, y eso se
 * notaba usándolo: recargar en la papelera devolvía a «Activos» sin decirlo,
 * Atrás no deshacía un cambio de pestaña porque nunca hubo entrada en el
 * historial, y un enlace compartido llevaba a otra lista distinta de la que
 * vio quien lo mandó.
 *
 * EL CÓDEC NO RECONSTRUYE LA QUERY ENTERA. Trabaja sobre la que ya hay, de
 * modo que los parámetros de la fusión de duplicados (`fusionar`, `con`,
 * `paso`, de 3.x) sobreviven a un cambio de pestaña. Reconstruirla desde cero
 * —como hace la bandeja, que no comparte pantalla con nadie— habría cerrado
 * el modal de fusión al teclear en el buscador.
 *
 * Funciones puras y fuera de la pantalla: así se puede comprobar qué
 * sobrevive a una recarga sin montar la tabla.
 */

export type VistaDeContactos = "activos" | "papelera";

export const PESTANAS: ReadonlyArray<{
  clave: VistaDeContactos;
  etiqueta: string;
  /** De qué contador del listado sale su cifra. */
  contador: "activos" | "archivados";
}> = [
  { clave: "activos", etiqueta: "Activos", contador: "activos" },
  { clave: "papelera", etiqueta: "Papelera", contador: "archivados" },
];

/** Tamaños de página admitidos. El backend acepta de 1 a 100. */
export const POR_PAGINA = [25, 50, 100] as const;
export const POR_PAGINA_POR_DEFECTO = 25;

export interface EstadoDeContactos {
  vista: VistaDeContactos;
  search: string;
  /** 1-indexada, que es como se lee y como se enseña. */
  pagina: number;
  porPagina: number;
}

function leerVista(valor: string | null): VistaDeContactos {
  // Cualquier otra cosa —incluido un valor inventado en la barra de
  // direcciones— es «Activos». Una lista vacía por un parámetro mal escrito
  // parecería que no hay contactos.
  return valor === "papelera" ? "papelera" : "activos";
}

function leerEntero(valor: string | null, porDefecto: number, min: number) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min) return porDefecto;
  return n;
}

export function leerEstadoDeContactos(
  params: URLSearchParams,
): EstadoDeContactos {
  const porPagina = leerEntero(
    params.get("porPagina"),
    POR_PAGINA_POR_DEFECTO,
    1,
  );

  return {
    vista: leerVista(params.get("vista")),
    search: (params.get("q") ?? "").trim(),
    pagina: leerEntero(params.get("pagina"), 1, 1),
    // Un tamaño fuera de la lista se ignora: el backend rechaza más de 100 y
    // un 400 en la primera carga dejaría la pantalla en error por un
    // parámetro que nadie escribió a mano.
    porPagina: (POR_PAGINA as readonly number[]).includes(porPagina)
      ? porPagina
      : POR_PAGINA_POR_DEFECTO,
  };
}

export interface CambiosDeContactos {
  vista?: VistaDeContactos;
  search?: string;
  pagina?: number;
  porPagina?: number;
}

/**
 * Aplica un cambio SOBRE la query actual y devuelve la nueva.
 *
 * Cambiar de pestaña, de búsqueda o de tamaño de página vuelve SIEMPRE a la
 * página 1: conservar «página 7» al buscar deja la lista vacía con resultados
 * que sí existen, y no hay forma de que el usuario entienda por qué.
 */
export function aplicarEnQuery(
  actual: URLSearchParams,
  cambios: CambiosDeContactos,
): string {
  const q = new URLSearchParams(actual.toString());

  const reiniciaPagina =
    cambios.vista !== undefined ||
    cambios.search !== undefined ||
    cambios.porPagina !== undefined;

  if (cambios.vista !== undefined) {
    // «Activos» es el valor por defecto: no se escribe, para que la lista
    // limpia deje la URL limpia y sea la que se copia y se comparte.
    if (cambios.vista === "activos") q.delete("vista");
    else q.set("vista", cambios.vista);
  }

  if (cambios.search !== undefined) {
    const limpia = cambios.search.trim();
    if (limpia) q.set("q", limpia);
    else q.delete("q");
  }

  if (cambios.porPagina !== undefined) {
    if (cambios.porPagina === POR_PAGINA_POR_DEFECTO) q.delete("porPagina");
    else q.set("porPagina", String(cambios.porPagina));
  }

  if (reiniciaPagina) q.delete("pagina");
  else if (cambios.pagina !== undefined) {
    if (cambios.pagina <= 1) q.delete("pagina");
    else q.set("pagina", String(cambios.pagina));
  }

  return q.toString();
}

/** La ruta completa que representa un estado. Para `volverA` y para navegar. */
export function rutaDeContactos(query: string): string {
  return query ? `/dashboard/contacts?${query}` : "/dashboard/contacts";
}

/**
 * Cuántos elementos hay que saltarse. El backend pagina por `offset`, no por
 * número de página: la conversión vive aquí y no repartida por la pantalla.
 */
export function offsetDe(estado: EstadoDeContactos): number {
  return (estado.pagina - 1) * estado.porPagina;
}

/** «Mostrando 1 a 25 de 1.248». Se calcula aquí para poder comprobarlo. */
export function rangoMostrado(
  estado: EstadoDeContactos,
  enPagina: number,
  total: number,
): { desde: number; hasta: number; total: number } {
  if (total === 0 || enPagina === 0) return { desde: 0, hasta: 0, total };
  const desde = offsetDe(estado) + 1;
  return { desde, hasta: desde + enPagina - 1, total };
}

export function totalDePaginas(estado: EstadoDeContactos, total: number) {
  return Math.max(1, Math.ceil(total / estado.porPagina));
}
