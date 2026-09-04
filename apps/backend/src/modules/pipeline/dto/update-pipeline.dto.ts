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

export class UpdatePipelineDto {
  // Si viene, no puede venir vacío: `PATCH {name: ''}` dejaba un embudo sin nombre.
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre del pipeline es requerido' })
  @MaxLength(PIPELINE_LIMITS.maxNameLength, {
    message: `El nombre del pipeline debe tener como máximo ${PIPELINE_LIMITS.maxNameLength} caracteres`,
  })
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  // Archivar retira el pipeline de la operación sin borrarlo. El servicio
  // impide archivar el predeterminado.
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
