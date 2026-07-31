import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  IsIn,
  Min,
  Max,
} from 'class-validator';

export class CreateStageDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la etapa es requerido' })
  name!: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  color?: string;

  // Probabilidad de cierre en porcentaje. Ausente significa "sin definir",
  // que no es lo mismo que 0.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  // Semántica comercial de la etapa: qué significa llegar a ella.
  @IsOptional()
  @IsIn(['OPEN', 'WON', 'LOST'], {
    message: 'type debe ser OPEN, WON o LOST',
  })
  type?: 'OPEN' | 'WON' | 'LOST';
}
