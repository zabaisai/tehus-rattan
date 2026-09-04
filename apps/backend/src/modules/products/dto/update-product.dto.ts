import {
  IsIn,
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  ValidateIf,
  IsBoolean,
} from 'class-validator';
import { CATALOG_ITEM_TYPES, type CatalogItemType } from '../catalog-item-type';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El precio debe ser un número' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Fase 2. Cambiar el tipo no toca stock, SKU ni ningún otro campo.
  // `ValidateIf` y no `IsOptional`: este ultimo deja pasar `null`, y un
  // `itemType: null` habria puesto la columna en NULL desde la API.
  @ValidateIf((o: { itemType?: unknown }) => o.itemType !== undefined)
  @IsIn(CATALOG_ITEM_TYPES, {
    message: 'itemType debe ser PRODUCT o SERVICE',
  })
  itemType?: CatalogItemType;
}
