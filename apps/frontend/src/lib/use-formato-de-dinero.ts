/**
 * Formato de dinero de la EMPRESA ACTIVA, para componentes.
 *
 * Vive aparte de `dinero.ts` para que el formateo siga siendo una función pura
 * sin React: los módulos de lógica (por ejemplo el del embudo) importan solo
 * las funciones y no arrastran el árbol de componentes.
 */
import { useMemo } from 'react';
import { useTenantCapabilities } from './tenant-capabilities';
import {
  REGION_POR_DEFECTO,
  formatearDinero,
  formatearDineroAbreviado,
  type RegionDeMoneda,
} from './dinero';

export interface FormatoDeDinero {
  region: RegionDeMoneda;
  /** Importe completo en la moneda de la empresa. */
  formatear: (valor: number | null | undefined) => string;
  /** Importe abreviado en millones para tarjetas de resumen. */
  abreviar: (valor: number | null | undefined) => string;
}

/**
 * Formato de dinero de la empresa activa. Se apoya en la configuración que el
 * shell autenticado ya tiene cargada, así que no añade ninguna petición.
 * Mientras no se conoce, usa los valores por defecto del producto.
 */
export function useFormatoDeDinero(): FormatoDeDinero {
  const capacidades = useTenantCapabilities();
  const regional = capacidades.configuration?.regional;
  const currency = regional?.currency;
  const locale = regional?.locale;

  return useMemo(() => {
    const region: RegionDeMoneda = {
      currency: currency || REGION_POR_DEFECTO.currency,
      locale: locale || REGION_POR_DEFECTO.locale,
    };
    return {
      region,
      formatear: (valor) => formatearDinero(valor, region),
      abreviar: (valor) => formatearDineroAbreviado(valor, region),
    };
  }, [currency, locale]);
}
