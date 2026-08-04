import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CustomFieldEntity, CustomFieldType } from '@prisma/client';
import { CLAVE_VALIDA } from '../custom-fields.types';

/**
 * Los DTO validan la FORMA. El servicio valida las REGLAS de negocio (que la
 * clave no exista ya, que un SELECT traiga opciones, que el destino sea de la
 * empresa). Separarlo evita el error clásico de confiar en el DTO para el
 * aislamiento multiempresa, que el DTO no puede comprobar porque no sabe quién
 * hace la petición.
 */

export class CrearCampoDto {
  @IsEnum(CustomFieldEntity)
  entity!: CustomFieldEntity;

  /** Opcional: si no viene, se deriva de la etiqueta. */
  @IsOptional()
  @IsString()
  @Matches(CLAVE_VALIDA, {
    message:
      'La clave debe empezar por letra y llevar solo minúsculas, números y guion bajo',
  })
  key?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsEnum(CustomFieldType)
  type!: CustomFieldType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  helpText?: string;

  /** `[{ value, label }]`. Su contenido lo valida el servicio. */
  @IsOptional()
  @IsArray()
  options?: unknown[];

  @IsOptional()
  validation?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

/**
 * No incluye `key`, `entity` ni `type` a propósito: son inmutables. Ver el
 * porqué en `actualizarDefinicion`.
 */
export class ActualizarCampoDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  helpText?: string;

  @IsOptional()
  @IsArray()
  options?: unknown[];

  @IsOptional()
  validation?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class EstablecerValorDto {
  @IsEnum(CustomFieldEntity)
  entity!: CustomFieldEntity;

  @IsString()
  @Matches(CLAVE_VALIDA)
  key!: string;

  /**
   * Sin tipo: lo decide la definición. Validarlo aquí obligaría a un DTO por
   * tipo de campo y aun así el servidor tendría que revalidarlo.
   */
  @IsOptional()
  valor?: unknown;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;
}
