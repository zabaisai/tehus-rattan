import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  MaxLength,
  Min,
} from 'class-validator';
import { PIPELINE_LIMITS } from '../../companies/company-settings';

export class CreatePipelineDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del pipeline es requerido' })
  @MaxLength(PIPELINE_LIMITS.maxNameLength, {
    message: `El nombre del pipeline debe tener como máximo ${PIPELINE_LIMITS.maxNameLength} caracteres`,
  })
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  // Orden en el selector. El servicio no lo infiere al crear: sin valor, el
  // pipeline entra con order 0 y la pantalla de administración lo reordena.
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
