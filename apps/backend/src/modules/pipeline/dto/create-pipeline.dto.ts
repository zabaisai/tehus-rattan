import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';

export class CreatePipelineDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del pipeline es requerido' })
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
