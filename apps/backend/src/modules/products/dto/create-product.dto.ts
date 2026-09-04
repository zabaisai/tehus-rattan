import {
  IsIn,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  ValidateIf,
} from 'class-validator';
import { CATALOG_ITEM_TYPES, type CatalogItemType } from '../catalog-item-type';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber({}, { message: 'El precio debe ser un número' })
  @Min(0, { message: 'El precio no puede ser negativo' })
  price!: number;

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

  // Fase 2. Opcional para que un cliente antiguo que no lo envía siga
  // creando PRODUCT (default de la columna). Solo se admiten los dos valores.
  // `ValidateIf` y no `IsOptional`: este ultimo deja pasar `null`, y un
  // `itemType: null` habria puesto la columna en NULL desde la API.
  @ValidateIf((o: { itemType?: unknown }) => o.itemType !== undefined)
  @IsIn(CATALOG_ITEM_TYPES, {
    message: 'itemType debe ser PRODUCT o SERVICE',
  })
  itemType?: CatalogItemType;
}
