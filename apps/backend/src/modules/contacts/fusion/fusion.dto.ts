import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const LADOS = ['principal', 'duplicado'] as const;

class VersionesDto {
  @IsString()
  @IsNotEmpty()
  principal!: string;

  @IsString()
  @IsNotEmpty()
  duplicado!: string;
}

class CamposDto {
  @IsOptional()
  @IsIn(LADOS)
  name?: 'principal' | 'duplicado';

  @IsOptional()
  @IsIn(LADOS)
  phone?: 'principal' | 'duplicado';

  @IsOptional()
  @IsIn(LADOS)
  email?: 'principal' | 'duplicado';
}

class EleccionesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CamposDto)
  campos?: CamposDto;

  /**
   * Id de definición → lado. Es un mapa abierto porque las definiciones las
   * crea cada empresa; el servicio ignora las claves que no correspondan a un
   * campo real de estos dos contactos.
   */
  @IsOptional()
  @IsObject()
  camposPersonalizados?: Record<string, 'principal' | 'duplicado'>;

  @IsOptional()
  @IsBoolean()
  conservarAlternativas?: boolean;
}

export class FusionarDto {
  @IsString()
  @IsNotEmpty()
  principalId!: string;

  @IsString()
  @IsNotEmpty()
  duplicadoId!: string;

  /**
   * Las marcas de versión que devolvió la comparación. Obligatorias: sin ellas
   * no hay forma de saber si lo que la persona decidió sigue siendo cierto.
   */
  @ValidateNested()
  @Type(() => VersionesDto)
  versiones!: VersionesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EleccionesDto)
  elecciones?: EleccionesDto;

  /**
   * Confirmación explícita de que ambos registros son la misma persona.
   *
   * No es un adorno del formulario: es la única parte de esta operación que
   * ninguna comprobación automática puede sustituir. El servidor la exige para
   * que un cliente distinto de la pantalla tampoco pueda saltársela.
   */
  @IsBoolean()
  confirmoMismaPersona!: boolean;
}

export class DescartarDuplicadoDto {
  @IsString()
  @IsNotEmpty()
  contactoAId!: string;

  @IsString()
  @IsNotEmpty()
  contactoBId!: string;
}
