import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CATEGORY_LIMITS } from '../company-settings';

class CatalogSettingsPatchDto {
  // La normalización real (recorte, duplicados sin distinguir mayúsculas) la
  // hace `normalizeCategories` en el servicio; aquí solo se acota la forma.
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

class CommercialSettingsPatchDto {
  @IsOptional() @IsBoolean() sellsProducts?: boolean;
  @IsOptional() @IsBoolean() sellsServices?: boolean;
  @IsOptional() @IsBoolean() usesCatalog?: boolean;
  @IsOptional() @IsBoolean() usesQuotes?: boolean;
  @IsOptional() @IsBoolean() usesTasks?: boolean;
}

/**
 * PATCH /companies/me/settings — edición parcial y tipada de la configuración
 * comercial. Nunca recibe `vertical` ni `pipelineDefaults`: esos los fija el
 * onboarding y describen cómo se creó la empresa, no cómo opera hoy.
 */
export class UpdateCompanySettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CatalogSettingsPatchDto)
  catalog?: CatalogSettingsPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CommercialSettingsPatchDto)
  commercial?: CommercialSettingsPatchDto;
}
