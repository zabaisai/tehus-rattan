import {
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  Min,
  Max,
  IsBoolean,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { STAGE_LIMITS } from '../../companies/company-settings';

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la etapa es requerido' })
  @MaxLength(STAGE_LIMITS.maxNameLength, {
    message: `El nombre de la etapa debe tener como máximo ${STAGE_LIMITS.maxNameLength} caracteres`,
  })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsIn(['OPEN', 'WON', 'LOST'], {
    message: 'type debe ser OPEN, WON o LOST',
  })
  type?: 'OPEN' | 'WON' | 'LOST';

  /**
   * La etapa por la que entra un cliente nuevo.
   *
   * Se marca a mano y no se adivina por el nombre: llamarla «Nuevo lead» es
   * una costumbre, no una regla, y una empresa que llame a la suya «Primer
   * contacto» tiene el mismo derecho a que sus leads caigan donde toca.
   */
  @IsOptional()
  @IsBoolean()
  isInitial?: boolean;
}
