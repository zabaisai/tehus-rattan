import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CATEGORY_LIMITS } from '../company-settings';
import { REGIONAL_LIMITS } from '../tenant-configuration';

/**
 * PATCH /companies/me/configuration — SOLO lo editable.
 *
 * La lista blanca es la política: el `ValidationPipe` global lleva
 * `forbidNonWhitelisted`, así que cualquier clave que no esté aquí
 * (`settings`, `storageVersion`, `contractVersion`, `identity`, `pipeline`,
 * `pipelineDefaults`, IDs internos…) se rechaza con 400 antes de llegar al
 * servicio. La validación semántica (IANA, ISO 4217, BCP 47, categorías) la
 * hace `tenant-configuration.ts`; aquí solo se acota la forma.
 */
class RegionalPatchDto {
  // `null` o vacío limpian el país; por eso `IsOptional` (que también deja
  // pasar `null`) y no `ValidateIf`.
  @IsOptional()
  @IsString()
  @MaxLength(REGIONAL_LIMITS.country.maxLength)
  country?: string | null;

  // Zona, moneda e idioma NO pueden quedar vacíos: `ValidateIf` solo omite la
  // validación cuando la clave no viene, así que `null` sigue siendo un 400.
  @ValidateIf((o: RegionalPatchDto) => o.timezone !== undefined)
  @IsString()
  @MaxLength(REGIONAL_LIMITS.timezone.maxLength)
  timezone?: string;

  @ValidateIf((o: RegionalPatchDto) => o.currency !== undefined)
  @IsString()
  @MaxLength(REGIONAL_LIMITS.currency.length)
  currency?: string;

  @ValidateIf((o: RegionalPatchDto) => o.locale !== undefined)
  @IsString()
  @MaxLength(REGIONAL_LIMITS.locale.maxLength)
  locale?: string;
}

class CommercialModelPatchDto {
  @IsOptional() @IsBoolean() sellsProducts?: boolean;
  @IsOptional() @IsBoolean() sellsServices?: boolean;
}

class OptionalModulesPatchDto {
  @IsOptional() @IsBoolean() catalog?: boolean;
  @IsOptional() @IsBoolean() quotes?: boolean;
  @IsOptional() @IsBoolean() tasks?: boolean;
}

class CatalogPatchDto {
  @IsArray()
  @ArrayMaxSize(CATEGORY_LIMITS.maxCount, {
    message: `Máximo ${CATEGORY_LIMITS.maxCount} categorías`,
  })
  @IsString({ each: true })
  @MaxLength(CATEGORY_LIMITS.maxLength, {
    each: true,
    message: `Cada categoría debe tener como máximo ${CATEGORY_LIMITS.maxLength} caracteres`,
  })
  categories!: string[];
}

export class UpdateTenantConfigurationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RegionalPatchDto)
  regional?: RegionalPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CommercialModelPatchDto)
  commercial?: CommercialModelPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OptionalModulesPatchDto)
  modules?: OptionalModulesPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CatalogPatchDto)
  catalog?: CatalogPatchDto;
}
