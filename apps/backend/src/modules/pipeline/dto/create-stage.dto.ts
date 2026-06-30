import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

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
}
