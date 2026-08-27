// Tope MÁXIMO de filas que cualquier listado devuelve en una sola petición.
//
// No es paginación de producto (eso son `limit`/`offset` explícitos, acotados a
// 1..100): es una GUARDIA anti-runaway para que ningún listado multiempresa sea
// ilimitado. 1000 es holgado —una vista normal de un CRM no llega ahí— pero
// acota el peor caso (memoria/respuesta) y evita que un tenant con muchísimos
// registros tumbe la respuesta. Para volúmenes mayores, la paginación explícita
// con `offset` es el camino.
export const MAX_LIST_ROWS = 1000;
