/**
 * Formato de dinero del CRM, en la moneda y el idioma de CADA empresa.
 *
 * Antes de la Fase 5 había trece formateadores repartidos por la interfaz, los
 * trece fijados a pesos colombianos, y una abreviatura que concatenaba el
 * símbolo de dólar a mano. Una empresa en otro país veía sus importes con la
 * moneda equivocada. Aquí vive el único formateador del frontend.
 *
 * La fuente de verdad es la región de la configuración del inquilino, la misma
 * que usa el backend para el PDF de una cotización: así la pantalla y el
 * documento impreso nunca discrepan. Aquí solo viven funciones puras, sin
 * React: el hook que lee la empresa activa está en `use-formato-de-dinero`.
 *
 * Esto es presentación y solo presentación. Ningún importe guardado se deriva
 * de una cadena formateada: los cálculos viven en el backend sobre decimales.
 */
export interface RegionDeMoneda {
  /** Código ISO de tres letras, por ejemplo COP o MXN. */
  currency: string;
  /** Etiqueta de idioma, por ejemplo es-CO. */
  locale: string;
}

/**
 * Valores del producto mientras no se conoce la empresa (pantalla cargando,
 * sesión de plataforma). Coinciden con los del backend a propósito.
 */
export const REGION_POR_DEFECTO: RegionDeMoneda = {
  currency: 'COP',
  locale: 'es-CO',
};

/** A partir de aquí se abrevia en millones en los paneles de resumen. */
const UMBRAL_DE_ABREVIATURA = 1_000_000;

function numeroSeguro(valor: number | null | undefined): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

/**
 * Último recurso cuando el idioma o la moneda guardados no son válidos: se
 * muestra el código y el importe en lugar de romper la pantalla. Es el mismo
 * comportamiento defensivo que ya tenía el documento de cotización.
 */
function respaldo(valor: number, region: RegionDeMoneda): string {
  return `${region.currency} ${numeroSeguro(valor).toFixed(2)}`;
}

/**
 * Formateador completo. Se expone porque algún componente necesita pasarlo
 * hacia abajo, pero lo normal es usar `formatearDinero`.
 */
export function formateadorDe(
  region: RegionDeMoneda = REGION_POR_DEFECTO,
): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat(region.locale, {
      style: 'currency',
      currency: region.currency,
      maximumFractionDigits: 0,
    });
  } catch {
    return null;
  }
}

/** Importe completo, sin abreviar. */
export function formatearDinero(
  valor: number | null | undefined,
  region: RegionDeMoneda = REGION_POR_DEFECTO,
): string {
  const numero = numeroSeguro(valor);
  const formateador = formateadorDe(region);
  return formateador ? formateador.format(numero) : respaldo(numero, region);
}

/**
 * Importe abreviado para tarjetas de resumen: a partir de un millón se escribe
 * en notación corta del propio idioma, con su símbolo de moneda. Por debajo se
 * escribe entero, que es lo que la gente espera leer.
 */
export function formatearDineroAbreviado(
  valor: number | null | undefined,
  region: RegionDeMoneda = REGION_POR_DEFECTO,
): string {
  const numero = numeroSeguro(valor);
  if (Math.abs(numero) < UMBRAL_DE_ABREVIATURA) {
    return formatearDinero(numero, region);
  }
  try {
    return new Intl.NumberFormat(region.locale, {
      style: 'currency',
      currency: region.currency,
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(numero);
  } catch {
    // Sin notación compacta (navegador antiguo o moneda inválida) se prefiere
    // el importe completo a no mostrar nada.
    return formatearDinero(numero, region);
  }
}
