/**
 * Tipo de elemento del catálogo (Fase 2).
 *
 * La columna `products.itemType` es nullable: las filas anteriores a la
 * Fase 2 valen NULL y se exponen como PRODUCT. Toda respuesta de la API pasa
 * por `effectiveItemType`, así que ningún cliente ve `null`.
 */
import { BadRequestException } from '@nestjs/common';

export const CATALOG_ITEM_TYPES = ['PRODUCT', 'SERVICE'] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];

export function isCatalogItemType(value: unknown): value is CatalogItemType {
  return (
    typeof value === 'string' &&
    (CATALOG_ITEM_TYPES as readonly string[]).includes(value)
  );
}

/** NULL (fila legacy) → PRODUCT. */
export function effectiveItemType(
  stored: CatalogItemType | null | undefined,
): CatalogItemType {
  return stored ?? 'PRODUCT';
}

export type ItemTypeWhere =
  | { itemType: CatalogItemType }
  | { OR: Array<{ itemType: CatalogItemType | null }> };

/**
 * Filtro `?itemType=` del listado. Un valor desconocido es un 400, no un
 * listado vacío en silencio. `PRODUCT` incluye las filas legacy en NULL.
 */
export function parseItemTypeFilter(
  raw: string | undefined,
): ItemTypeWhere | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!isCatalogItemType(raw)) {
    throw new BadRequestException('itemType debe ser PRODUCT o SERVICE');
  }
  if (raw === 'PRODUCT') {
    return { OR: [{ itemType: 'PRODUCT' }, { itemType: null }] };
  }
  return { itemType: 'SERVICE' };
}

/**
 * Valor tal como llega de una importación o de un formulario: sin distinguir
 * mayúsculas ni acentos, en español o en inglés. Devuelve `null` si no se
 * reconoce, para que quien llama decida si es un error (importación) o no.
 */
export function parseItemTypeLabel(raw: string): CatalogItemType | null {
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (key === 'PRODUCT' || key === 'PRODUCTO') return 'PRODUCT';
  if (key === 'SERVICE' || key === 'SERVICIO') return 'SERVICE';
  return null;
}
