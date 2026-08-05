/**
 * Nombres visibles del producto.
 *
 * Existen para que renombrar sea cambiar una constante y no peinar la interfaz
 * a mano. Lo que hay DENTRO —tablas, modelos, rutas de API, clases, colas,
 * metricas, identificadores— sigue llamandose `flowbot` y no se toca: renombrar
 * eso obligaria a una migracion con riesgo real a cambio de nada, porque nadie
 * que use el producto ve un nombre de tabla.
 *
 * Si algun dia el nombre visible vuelve a cambiar, se cambia aqui.
 */
export const NOMBRE_PULSO = "TAKTO Pulso";

/** Para frases donde «TAKTO Pulso» suena repetitivo dentro del propio TAKTO. */
export const NOMBRE_PULSO_CORTO = "Pulso";
